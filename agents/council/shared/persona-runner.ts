/**
 * Per-persona evaluation + staking pipeline.
 *
 * For one persona and one claim:
 *   1. Cheap skips (own claim, already in, full, bankroll below 2× base stake),
 *      before any evidence fetch or LLM call.
 *   2. Decide: specialists outside their exact category abstain; rule-based
 *      personas read the pool; everyone else asks the LLM with its bias
 *      prompt over the cycle's cached evidence (and, when enabled, a few
 *      peers' reads from this cycle).
 *   3. Money only on evidence the oracle trusts: an LLM persona stakes only
 *      when the evidence came from a structured API source (the oracle's
 *      API_FETCHERS; scraped pages can serve the bot one thing and settle on
 *      another, audit P0-2), after the oracle's fetcher-trust cap. Rule
 *      personas act only on house markets, off on mainnet by default (P2-4).
 *   4. Size the stake: Kelly at the real pool odds against the persona's
 *      bankroll (lib/kelly.ts challengerKellyStake, capped), the base stake
 *      for rule personas.
 *   5. Stake from the persona's Arc wallet (convex/arcCouncil.ts).
 *
 * Every LLM verdict is logged (lib/server/forecasts.ts), staked on or not: scoring only
 * the stakes would hide the calls a persona got wrong by abstaining.
 */
import { recordForecast } from "../../../lib/server/forecasts";
import { ARC } from "../../../lib/arc/config";
import { API_FETCHERS, applyFetcherTrust } from "../../oracle/decide";
import type { PersonaSpec } from "../personas";
import { getOrFetchEvidence } from "./evidence-cache";
import { evaluateClaimAsPersona, type PersonaLLM } from "./persona-llm";
import type { PeerBoard } from "./peer-reasoning";
import {
  DEFAULT_MIN_CONFIDENCE,
  categoryMatches,
  ruleDecision,
  rulePersonaGate,
  sizeStakeUnits,
} from "./persona-rules";
import type { CouncilClaim, EvidenceCacheEntry, PersonaDecision } from "./types";
import type { EvidenceFetcherKind } from "../../../lib/server/evidence-fetcher";

/** P(challengers win) from a verdict: 50% ± confidence/2 (the self-resolving council's mapping). */
function probabilityFromVerdict(verdict: string, confidence: number): number {
  const c = Math.max(0, Math.min(100, confidence));
  if (verdict === "CHALLENGERS_WIN") return 0.5 + c / 200;
  if (verdict === "CREATOR_WINS") return 0.5 - c / 200;
  return 0.5;
}

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
  /** The house market-creator's address; rule personas only act on its markets. null: unknown. */
  houseCreator?: string | null;
  /** Network override for tests; defaults to Arc mainnet or not. */
  mainnet?: boolean;
}

/** COUNCIL_RULE_PERSONAS_MAINNET=1 lets rule personas run on mainnet (house markets only). */
const RULE_PERSONAS_MAINNET = process.env.COUNCIL_RULE_PERSONAS_MAINNET === "1";

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

/** Decision only: no on-chain writes. */
export async function evaluatePersonaForClaim(
  persona: PersonaSpec,
  claim: CouncilClaim,
  ctx: RunnerContext,
): Promise<PersonaDecision> {
  if (!categoryMatches(persona, claim.category)) {
    return {
      shouldStake: false,
      stakeUsdc: 0,
      rationale: `${persona.displayName} only watches ${persona.categoryFilter?.join(" / ")} markets; this one is out of scope.`,
      skipReason: "category-filter",
    };
  }

  const gate = rulePersonaGate(persona, claim, {
    houseCreator: ctx.houseCreator ?? null,
    mainnet: ctx.mainnet ?? ARC.network === "mainnet",
    mainnetOverride: RULE_PERSONAS_MAINNET,
  });
  if (gate) return gate;
  const rule = ruleDecision(persona, claim);
  if (rule) return rule;

  const key = claim.id.toString();
  const evidence = await getOrFetchEvidence(key, claim.resolutionUrl, ctx.evidenceCache);
  if (evidence.fetcher === "none") {
    return {
      shouldStake: false,
      stakeUsdc: 0,
      rationale: `${persona.displayName}: no usable evidence at the resolution URL, abstaining.`,
      skipReason: "no-evidence",
    };
  }
  const apiEvidence = API_FETCHERS.has(evidence.fetcher);
  const nonApi: PersonaDecision = {
    shouldStake: false,
    stakeUsdc: 0,
    rationale: `${persona.displayName} won't stake: the evidence is a scraped page (${evidence.fetcher}), not a structured API source.`,
    skipReason: "non-api-evidence",
  };
  // Nothing to stake and nothing to log: skip the LLM call.
  if (!apiEvidence && !ctx.recordForecasts) return nonApi;

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

  // The forecast above keeps the persona's own read; money follows the oracle's trust rules.
  if (!apiEvidence) return { ...nonApi, confidence: verdict.confidence, verdict: verdict.verdict };
  verdict = { ...verdict, confidence: applyFetcherTrust(verdict, evidence.fetcher as EvidenceFetcherKind).confidence };

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

