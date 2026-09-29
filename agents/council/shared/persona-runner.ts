/**
 * Per-persona evaluation + staking pipeline.
 *
 * For one persona and one claim:
 *   1. Cheap skips (own claim, already in, full, bankroll below 2× base stake)
 *      — before any evidence fetch or LLM call.
 *   2. Decide: specialists outside their exact category abstain; rule-based
 *      personas read the pool; everyone else asks the LLM with its bias
 *      prompt over the cycle's cached evidence (and, when enabled, a few
 *      peers' reads from this cycle).
 *   3. Size the stake: Kelly on the LLM confidence against the persona's ER
 *      bankroll (lib/kelly.ts, capped), the base stake for rule personas.
 *   4. Stake with challenge_claim inside the MagicBlock Ephemeral Rollup.
 *
 * Every LLM verdict is logged for /calibration, staked on or not: scoring only
 * the stakes would hide the calls a persona got wrong by abstaining.
 */
import { recordForecast } from "../../../lib/server/forecasts";
import { probabilityFromVerdict } from "../../../lib/calibration";
import { fromUsdcUnits } from "../../../lib/solana/config";
import type { MimirSolanaClient } from "../../../lib/solana/client";
import type { PersonaSpec } from "../personas";
import { getOrFetchEvidence } from "./evidence-cache";
import { evaluateClaimAsPersona, type PersonaLLM } from "./persona-llm";
import type { PeerBoard } from "./peer-reasoning";
import {
  DEFAULT_MIN_CONFIDENCE,
  categoryMatches,
  ruleDecision,
  sizeStakeUnits,
} from "./persona-rules";
import type { CouncilClaim, EvidenceCacheEntry, PersonaDecision } from "./types";

export interface RunnerContext {
  /** One Map per cycle, keyed by claim id. */
  evidenceCache: Map<string, EvidenceCacheEntry>;
  /** Waits out the LLM throttle before each call. */
  throttle: () => Promise<void>;
  peers?: PeerBoard;
  /** Peer reads per decision (0 = off). */
  peerReads?: number;
  llm?: PersonaLLM;
  /** Log forecasts to the DB (off for UI / preview reads). */
  recordForecasts?: boolean;
}

/** A serial gap between calls, shared by every persona in the process. */
export function createThrottle(gapMs: number): () => Promise<void> {
  let last = 0;
  let chain: Promise<void> = Promise.resolve();
  return () => {
    chain = chain.then(async () => {
      const wait = gapMs - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    return chain;
  };
}

/** Decision only — no on-chain writes. */
export async function evaluatePersonaForClaim(
  persona: PersonaSpec,
  claim: CouncilClaim,
  ctx: RunnerContext,
): Promise<PersonaDecision> {
  if (!categoryMatches(persona, claim.category)) {
    return {
      shouldStake: false,
      stakeUsdc: 0,
      rationale: `${persona.displayName} only watches ${persona.categoryFilter?.join(" / ")} markets — this one is out of scope.`,
      skipReason: "category-filter",
    };
  }

  const rule = ruleDecision(persona, claim);
  if (rule) return rule;

  const key = claim.id.toString();
  const evidence = await getOrFetchEvidence(key, claim.resolutionUrl, ctx.evidenceCache);
  if (evidence.fetcher === "none") {
    return {
      shouldStake: false,
      stakeUsdc: 0,
      rationale: `${persona.displayName}: no usable evidence at the resolution URL — abstaining.`,
      skipReason: "no-evidence",
    };
  }

  let verdict;
  try {
    await ctx.throttle();
    const peerReads = ctx.peers?.readsFor(key, persona.slug, ctx.peerReads ?? 0, Number(claim.id)) ?? [];
    verdict = await evaluateClaimAsPersona(persona, claim, evidence.text, { peerReads, llm: ctx.llm });
  } catch (err) {
    return {
      shouldStake: false,
      stakeUsdc: 0,
      rationale: `${persona.displayName}: LLM call failed (${err instanceof Error ? err.message.slice(0, 80) : "unknown"}).`,
      skipReason: "llm-failed",
    };
  }

  ctx.peers?.record(key, { slug: persona.slug, displayName: persona.displayName, text: verdict.explanation });
  if (ctx.recordForecasts && (verdict.verdict !== "UNRESOLVABLE" || verdict.confidence > 0)) {
    await recordForecast({
      claimId: Number(claim.id),
      forecaster: persona.slug,
      pChallengers: probabilityFromVerdict(verdict.verdict, verdict.confidence),
      verdict: verdict.verdict,
      confidence: verdict.confidence,
    }).catch(() => undefined);
  }

  const minConf = persona.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const base = { confidence: verdict.confidence, verdict: verdict.verdict };
  if (verdict.verdict === "CREATOR_WINS") {
    return {
      ...base,
      shouldStake: false,
      stakeUsdc: 0,
      rationale: `${persona.displayName} agrees with the creator (${verdict.confidence}%): ${verdict.explanation}`,
      skipReason: "abstain-agrees-with-creator",
    };
  }
  if (verdict.verdict !== "CHALLENGERS_WIN" || verdict.confidence < minConf) {
    return {
      ...base,
      shouldStake: false,
      stakeUsdc: 0,
      rationale: `${persona.displayName} won't stake: ${verdict.verdict} at ${verdict.confidence}% (threshold ${minConf}%). ${verdict.explanation}`,
      skipReason: "abstain-low-confidence",
    };
  }
  return {
    ...base,
    shouldStake: true,
    stakeUsdc: persona.stakeUsdc ?? 2,
    rationale: `${persona.displayName} stakes: ${verdict.explanation}`,
  };
}

export type RunOutcome =
  /** Not considered this cycle (own claim, already in, full, low bankroll). */
  | { kind: "skipped"; reason: string }
  /** A considered no. Safe to remember until the re-evaluation window passes. */
  | { kind: "abstained"; decision: PersonaDecision }
  /** A transient failure (LLM error, no evidence yet): look again next cycle. */
  | { kind: "retry"; decision: PersonaDecision }
  | { kind: "staked"; decision: PersonaDecision; stakeUnits: bigint; sig: string | null };

/** Full pipeline: decide, size, and stake in the ER (unless `dryRun`). */
export async function runPersonaForClaim(
  persona: PersonaSpec,
  client: MimirSolanaClient,
  claim: CouncilClaim,
  ctx: RunnerContext & { dryRun?: boolean },
): Promise<RunOutcome> {
  const me = client.publicKey;
  if (claim.creator.equals(me)) return { kind: "skipped", reason: "self-created" };
  if (claim.challengers.some((c) => c.addr.equals(me))) return { kind: "skipped", reason: "already-challenged" };
  if (claim.challengers.length >= claim.maxChallengers) return { kind: "skipped", reason: "full" };

  const bankroll = await client.getBalance();
  if (sizeStakeUnits({ baseUsdc: persona.stakeUsdc, bankrollUnits: bankroll }) === null && !ctx.dryRun) {
    return { kind: "skipped", reason: `insufficient ER balance (${fromUsdcUnits(bankroll)} USDC)` };
  }

  const decision = await evaluatePersonaForClaim(persona, claim, ctx);
  if (!decision.shouldStake) {
    const transient = decision.skipReason === "llm-failed" || decision.skipReason === "no-evidence";
    // Rule personas react to a pool that keeps moving: never remember their no.
    const considered = !transient && persona.archetype !== "rule-based";
    return considered ? { kind: "abstained", decision } : { kind: "retry", decision };
  }

  const stakeUnits =
    sizeStakeUnits({ baseUsdc: persona.stakeUsdc, confidence: decision.confidence, bankrollUnits: bankroll }) ??
    sizeStakeUnits({ baseUsdc: persona.stakeUsdc, bankrollUnits: 2n ** 62n })!; // dry run with no bankroll: show the base
  if (ctx.dryRun) return { kind: "staked", decision, stakeUnits, sig: null };
  const sig = await client.challengeClaimER(claim.id, stakeUnits);
  return { kind: "staked", decision, stakeUnits, sig };
}
