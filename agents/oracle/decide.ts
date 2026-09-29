/**
 * How the oracle decides a claim, in order:
 *   1. fetch the resolution URL's evidence;
 *   2. sports / Polymarket claims wait for a final result (bounded by a grace);
 *   3. price claims read the price AT THE DEADLINE from independent sources;
 *   4. a structured resolver spec (in the resolution URL fragment) settles it
 *      from data alone when the data is determinate — no model is asked;
 *   5. no evidence at all: wait up to 6h, then refund (UNRESOLVABLE);
 *   6. the council jury (COUNCIL_SETTLEMENT=1) or the oracle's own LLM verdict;
 *   7. the price cross-check: disagreeing sources, or a model contradicting
 *      agreeing sources, refund; agreement boosts only the side the data backs;
 *   8. fetcher trust caps, confidence tiers, and the "oracle holds a position
 *      → FIRM verdicts only" rule.
 * Everything it rested on is sealed into a verdict audit bundle whose sha256
 * becomes the on-chain evidence_hash. Returns null when settlement should
 * wait for a later poll.
 */
import type { PublicKey } from "@solana/web3.js";
import type { OnchainClaim } from "../../lib/solana/client";
import { MIMIR_PROGRAM_ID } from "../../lib/solana/config";
import {
  fetchEvidence as fetchEvidenceShared,
  EvidenceFetchError,
  type EvidenceFetcherKind,
} from "../../lib/server/evidence-fetcher";
import { gatewayFetch } from "../../lib/research/gateway";
import {
  evaluateJsonSpec,
  evaluatePriceSpec,
  resolverSpecFor,
  stripResolverFragment,
  winnerFor,
  type ResolverOutcome,
} from "../../lib/resolver-spec";
import {
  consensusWinner,
  crossCheckThreshold,
  priceCheckTarget,
  settlementAdjustment,
  type PriceReading,
} from "../../lib/price-consensus";
import { fetchPriceReadings, hasSecondPriceSource } from "../../lib/server/price-sources";
import { sealBundle, VERDICT_BUNDLE_VERSION, type VerdictBundle } from "../../lib/verdict-bundle";
import { evaluateClaim, isEventFinal, type OracleVerdict } from "./evaluate";
import {
  gatherCouncilVerdict,
  scoreCouncilVotes,
  verdictToProbability,
  Q_PRIOR,
  type CouncilVote,
  type SelfResolvingConfig,
} from "./council-vote";

const MAX_CONTENT_CHARS = 8_000;
const SPORTS_SETTLE_GRACE_SECS = Math.max(1, Number(process.env.SPORTS_SETTLE_GRACE_HOURS ?? 12)) * 3600;
// UMA's liveness plus a dispute round fits comfortably inside three days.
const POLYMARKET_SETTLE_GRACE_SECS = 72 * 3600;
/** How long past the deadline an unreadable source is retried before refunding. */
export const NO_EVIDENCE_GRACE_SECS = 6 * 3600;

export const CONFIDENCE_HIGH_MIN = 80; // ≥ : settle as-is
export const CONFIDENCE_MED_MIN = 60; // 60–79: settle, marked [CONTESTED]; < 60: refund
/** Scraped HTML can drift or be partially blocked: no FIRM settlement off it. */
const MAX_CONFIDENCE_NON_API = 75;
const API_FETCHERS: ReadonlySet<string> = new Set(["coingecko-api", "flashtrade-api", "espn-api"]);

export interface JuryConfig {
  quorum: number;
  selfResolving?: SelfResolvingConfig;
  /** slug → persona wallet (base58). */
  wallets: ReadonlyMap<string, string>;
  /** persona wallet (base58) → slug, to find jurors holding a position. */
  slugByAddress: ReadonlyMap<string, string>;
}

export interface DecideContext {
  oracle: PublicKey;
  /** Council-as-jury settlement, when enabled. */
  jury: JuryConfig | null;
  now?: () => number;
}

export interface SettlementDecision {
  verdict: OracleVerdict;
  /** sha256 of the bundle's canonical JSON: what goes on chain. */
  evidenceHash: Uint8Array;
  bundle: VerdictBundle;
  /** Scored jurors to pay a bonus after the proposal lands (self-resolving mode). */
  bonusVotes: CouncilVote[] | null;
}

interface Evidence {
  text: string;
  fetcher: EvidenceFetcherKind | "none";
}

interface DeadlinePrices {
  symbol: string;
  threshold: number;
  readings: PriceReading[];
}

type BundleParts = Omit<VerdictBundle, "version" | "program" | "claimId" | "decidedAt" | "claim" | "finalVerdict">;

async function fetchEvidence(url: string): Promise<Evidence> {
  const target = stripResolverFragment(url ?? "");
  if (!target.startsWith("http")) return { text: "(No resolution URL provided)", fetcher: "none" };
  try {
    const snap = await fetchEvidenceShared(target, { maxChars: MAX_CONTENT_CHARS, userAgent: "Mimir-Oracle/1.0" });
    return { text: snap.text, fetcher: snap.fetcher };
  } catch (err: any) {
    const msg = err instanceof EvidenceFetchError ? err.message : err?.message ?? "unknown";
    return { text: `(Failed to fetch: ${msg})`, fetcher: "none" };
  }
}

function isPolymarketUrl(url: string): boolean {
  try {
    const host = new URL(stripResolverFragment(url)).hostname.toLowerCase();
    return host === "polymarket.com" || host.endsWith(".polymarket.com");
  } catch {
    return false;
  }
}

export function tierVerdict(v: OracleVerdict): OracleVerdict {
  if (v.verdict === "UNRESOLVABLE" || v.verdict === "DRAW") return v;
  if (v.confidence >= CONFIDENCE_HIGH_MIN) return v;
  if (v.confidence >= CONFIDENCE_MED_MIN) return { ...v, explanation: `[CONTESTED] ${v.explanation}`.slice(0, 500) };
  return {
    verdict: "UNRESOLVABLE",
    confidence: v.confidence,
    explanation: `[LOW CONFIDENCE — refunded] ${v.explanation}`.slice(0, 500),
    model: v.model,
  };
}

export function applyFetcherTrust(v: OracleVerdict, fetcher: EvidenceFetcherKind | "none"): OracleVerdict {
  if (API_FETCHERS.has(fetcher) || v.verdict === "UNRESOLVABLE") return v;
  return {
    ...v,
    confidence: Math.min(v.confidence, MAX_CONFIDENCE_NON_API),
    explanation: `[via-${fetcher}] ${v.explanation}`.slice(0, 500),
  };
}

/**
 * The price cross-check. Disagreement is not a tie-break for the model: the
 * data does not support a verdict, so it refunds. Agreement only earns
 * confidence for the side the data backs; a model picking the other side is
 * refunded too.
 */
export function applyPriceConsensus(
  claim: Pick<OnchainClaim, "question" | "creatorPosition" | "counterPosition" | "deadline">,
  verdict: OracleVerdict,
  prices: DeadlinePrices | null,
): { verdict: OracleVerdict; note: string | null } {
  if (!prices || !hasSecondPriceSource(prices.symbol) || prices.readings.length < 2) return { verdict, note: null };
  const consensus = crossCheckThreshold(prices.readings, prices.threshold, claim.deadline * 1000);
  const adj = settlementAdjustment(consensus);
  const dataWinner = consensusWinner(claim.question, claim.creatorPosition, claim.counterPosition, consensus.verdict);
  console.log(
    `[settle] Price cross-check ${prices.symbol} @ $${prices.threshold}: ${consensus.verdict} ` +
      `(${prices.readings.map((r) => `${r.source}=${r.priceUsd.toFixed(2)}`).join(", ")})`,
  );
  if (adj.forceUnresolvable) {
    return {
      verdict: { verdict: "UNRESOLVABLE", confidence: verdict.confidence, explanation: `[SOURCES DISAGREE — refunded] ${adj.note}`.slice(0, 500), model: verdict.model },
      note: adj.note,
    };
  }
  const pickedSide = verdict.verdict === "CREATOR_WINS" || verdict.verdict === "CHALLENGERS_WIN";
  if (dataWinner && pickedSide && verdict.verdict !== dataWinner) {
    return {
      verdict: {
        verdict: "UNRESOLVABLE",
        confidence: verdict.confidence,
        explanation: `[MODEL VS PRICE DATA — refunded] The model chose ${verdict.verdict} but ${adj.note}`.slice(0, 500),
        model: verdict.model,
      },
      note: `${adj.note} Model verdict ${verdict.verdict} contradicts it.`,
    };
  }
  if (adj.confidenceDelta > 0 && dataWinner && verdict.verdict === dataWinner) {
    return { verdict: { ...verdict, confidence: Math.min(100, verdict.confidence + adj.confidenceDelta) }, note: adj.note };
  }
  return { verdict, note: adj.note };
}

function renderPrices(claim: OnchainClaim, p: DeadlinePrices): string {
  const lines = p.readings.map(
    (r) => `- ${r.source}: $${r.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 6 })} at ${new Date(r.at).toISOString()}`,
  );
  return `[${p.symbol}/USD at the claim deadline ${new Date(claim.deadline * 1000).toISOString()}]\n${lines.join("\n")}`;
}

const bundlePrices = (p: DeadlinePrices): NonNullable<VerdictBundle["prices"]> => ({
  symbol: p.symbol,
  threshold: p.threshold,
  readings: p.readings.map((r) => ({ source: r.source, priceUsd: r.priceUsd, at: r.at })),
});

const bundleEvidence = (e: Evidence): NonNullable<VerdictBundle["evidence"]> => ({
  fetcher: e.fetcher,
  text: e.text.slice(0, MAX_CONTENT_CHARS),
});

/** Seal everything a decision rested on into the audit bundle whose hash goes on chain. */
export function decisionFor(
  claim: OnchainClaim,
  verdict: OracleVerdict,
  parts: BundleParts,
  bonusVotes: CouncilVote[] | null = null,
  decidedAt = Date.now(),
): SettlementDecision {
  const bundle: VerdictBundle = {
    version: VERDICT_BUNDLE_VERSION,
    program: MIMIR_PROGRAM_ID.toBase58(),
    claimId: Number(claim.id),
    decidedAt,
    claim: {
      question: claim.question,
      creatorPosition: claim.creatorPosition,
      counterPosition: claim.counterPosition,
      resolutionUrl: claim.resolutionUrl,
      category: claim.category,
      deadline: claim.deadline,
    },
    ...parts,
    finalVerdict: { verdict: verdict.verdict, confidence: verdict.confidence, explanation: verdict.explanation },
  };
  return { verdict, evidenceHash: sealBundle(bundle).bytes, bundle, bonusVotes };
}

async function deadlinePrices(claim: OnchainClaim, symbolHint?: string, thresholdHint?: number): Promise<DeadlinePrices | null> {
  const target = priceCheckTarget(claim.question) ?? (symbolHint && thresholdHint ? { symbol: symbolHint, threshold: thresholdHint } : null);
  if (!target) return null;
  const readings = await fetchPriceReadings(target.symbol, claim.deadline * 1000).catch(() => []);
  return { ...target, readings };
}

/** Settle from the resolver spec when the data is determinate on Yes/No positions; null otherwise. */
async function tryStructuredResolver(claim: OnchainClaim, prices: DeadlinePrices | null): Promise<SettlementDecision | null> {
  const spec = resolverSpecFor({ resolutionUrl: claim.resolutionUrl });
  if (!spec) return null;
  let outcome: ResolverOutcome;
  if (spec.kind === "price") {
    const readings = prices && prices.symbol === spec.symbol
      ? prices.readings
      : await fetchPriceReadings(spec.symbol, claim.deadline * 1000).catch(() => []);
    outcome = evaluatePriceSpec(spec, readings);
  } else {
    try {
      // Read at settlement time: right for final results, wrong for live values.
      const res = await gatewayFetch(spec.url, { headers: { accept: "application/json", "user-agent": "Mimir-Oracle/1.0" } });
      outcome = res.status === 200
        ? evaluateJsonSpec(spec, JSON.parse(res.body))
        : { determined: false, detail: `resolver source answered ${res.status}` };
    } catch (err) {
      outcome = { determined: false, detail: `resolver source unreadable: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const side = outcome.determined ? winnerFor(outcome.conditionMet, claim.creatorPosition, claim.counterPosition) : null;
  console.log(`[settle] Structured resolver (${spec.kind}): ${outcome.detail}${side ? ` → ${side}` : " → not determined, falling back"}`);
  if (!outcome.determined || !side) return null;
  const verdict: OracleVerdict = {
    verdict: side,
    confidence: 95,
    explanation: `[RESOLVER] ${outcome.detail}`.slice(0, 500),
    model: "structured-resolver",
  };
  return decisionFor(claim, verdict, {
    resolver: { spec, detail: outcome.detail },
    prices: prices && prices.readings.length ? bundlePrices(prices) : undefined,
    model: "structured-resolver",
    adjustments: [],
  });
}

/** Personas holding a position in the claim (never jurors on it). */
function stakedSlugs(claim: OnchainClaim, jury: JuryConfig): Set<string> {
  const out = new Set<string>();
  for (const addr of [claim.creator, ...claim.challengers.map((c) => c.addr)]) {
    const slug = jury.slugByAddress.get(addr.toBase58());
    if (slug) out.add(slug);
  }
  return out;
}

export async function decide(ctx: DecideContext, claim: OnchainClaim): Promise<SettlementDecision | null> {
  const nowSec = Math.floor((ctx.now?.() ?? Date.now()) / 1000);
  const evidence = await fetchEvidence(claim.resolutionUrl);
  console.log(`[settle] Evidence fetcher: ${evidence.fetcher}`);

  // Sports close betting at kickoff; a Polymarket end date is when trading
  // stops, not when UMA resolves. Both wait for a final result, bounded.
  const graceSecs =
    claim.category.toLowerCase() === "sports" ? SPORTS_SETTLE_GRACE_SECS
    : isPolymarketUrl(claim.resolutionUrl) ? POLYMARKET_SETTLE_GRACE_SECS
    : 0;
  if (graceSecs > 0 && nowSec <= claim.deadline + graceSecs && evidence.fetcher !== "none") {
    if (!(await isEventFinal(claim, evidence.text))) {
      console.log(`[settle] Claim #${claim.id}: outcome not final yet — deferring.`);
      return null;
    }
  }

  const spec = resolverSpecFor({ resolutionUrl: claim.resolutionUrl });
  const prices = await deadlinePrices(claim, spec?.kind === "price" ? spec.symbol : undefined, spec?.kind === "price" ? spec.threshold : undefined);
  const hasPrices = (prices?.readings.length ?? 0) > 0;
  const evidenceText = prices && hasPrices ? `${evidence.text}\n\n${renderPrices(claim, prices)}` : evidence.text;

  const structured = await tryStructuredResolver(claim, prices);
  if (structured) return structured;

  // No evidence: a model answering from memory is not a settlement. Wait out
  // a transient outage, then refund rather than guess.
  if (evidence.fetcher === "none" && !hasPrices) {
    if (nowSec < claim.deadline + NO_EVIDENCE_GRACE_SECS) {
      console.log(`[settle] Claim #${claim.id}: no evidence fetched — deferring.`);
      return null;
    }
    const verdict: OracleVerdict = {
      verdict: "UNRESOLVABLE",
      confidence: 0,
      explanation: `[NO EVIDENCE — refunded] The resolution source could not be read within ${NO_EVIDENCE_GRACE_SECS / 3600}h of the deadline.`,
    };
    return decisionFor(claim, verdict, {
      evidence: bundleEvidence(evidence),
      adjustments: [`no evidence within ${NO_EVIDENCE_GRACE_SECS / 3600}h of the deadline: refunded`],
    });
  }

  const adjustments: string[] = [];
  let rawVerdict: OracleVerdict;
  let councilRecord: VerdictBundle["council"];
  let bonusVotes: CouncilVote[] | null = null;
  try {
    const council = ctx.jury
      ? await gatherCouncilVerdict({
          claim,
          evidence: evidenceText,
          wallets: ctx.jury.wallets,
          staked: stakedSlugs(claim, ctx.jury),
          quorum: ctx.jury.quorum,
          selfResolving: ctx.jury.selfResolving,
        }).catch((err) => {
          console.warn("[settle] council vote failed, settling solo:", err instanceof Error ? err.message : err);
          return null;
        })
      : null;
    if (council && ctx.jury?.selfResolving) {
      // The reference report reads the evidence alone: if it saw the jurors'
      // reports they could steer the belief they are paid for matching.
      const reference = await evaluateClaim(claim, evidenceText);
      const referenceQ = verdictToProbability(reference.verdict, reference.confidence, Q_PRIOR);
      council.votes = scoreCouncilVotes(council.votes, referenceQ);
      console.log(`[settle] Self-resolving jury: q_T=${referenceQ.toFixed(2)} · ${council.votes.map((v) => `${v.slug}=${(v.score ?? 0).toFixed(3)}`).join(" ")}`);
      rawVerdict = reference;
      councilRecord = {
        tally: { ...council.tally, scores: council.votes.map((v) => Number((v.score ?? 0).toFixed(4))) },
        votes: council.votes.map((v) => ({ slug: v.slug, verdict: v.verdict, confidence: v.confidence })),
        excluded: council.excluded,
        qHistory: council.qHistory,
        referenceQ: Number(referenceQ.toFixed(4)),
      };
      bonusVotes = council.votes;
    } else if (council) {
      console.log(`[settle] Council ${council.tally.creator}–${council.tally.challengers} (${council.tally.draw + council.tally.unresolvable} abstain)`);
      rawVerdict = { verdict: council.verdict, confidence: council.confidence, explanation: council.explanation, model: "council-tally" };
      councilRecord = {
        tally: council.tally,
        votes: council.votes.map((v) => ({ slug: v.slug, verdict: v.verdict, confidence: v.confidence })),
        excluded: council.excluded,
      };
    } else {
      if (ctx.jury) console.log("[settle] Council below quorum — settling solo.");
      rawVerdict = await evaluateClaim(claim, evidenceText);
    }
  } catch (err: any) {
    // LLM rate-limited or unparseable: wait for a later poll instead of
    // proposing a refund on a transient failure.
    console.log(`[settle] Claim #${claim.id}: LLM unavailable (${String(err?.message ?? err).slice(0, 80)}) — retry later`);
    return null;
  }

  const consensus = applyPriceConsensus(claim, rawVerdict, prices);
  if (consensus.note) adjustments.push(`price consensus: ${consensus.note}`);
  const trusted = applyFetcherTrust(consensus.verdict, evidence.fetcher);
  if (trusted.confidence !== consensus.verdict.confidence) {
    adjustments.push(`fetcher trust (${evidence.fetcher}): confidence capped at ${trusted.confidence}`);
  }
  let verdict = tierVerdict(trusted);
  if (verdict.verdict !== trusted.verdict) adjustments.push(`confidence ${trusted.confidence} below ${CONFIDENCE_MED_MIN}: refunded`);

  // The oracle judging a market it holds a position in settles FIRM verdicts only.
  const oracleHasStake = claim.creator.equals(ctx.oracle) || claim.challengers.some((c) => c.addr.equals(ctx.oracle));
  if (oracleHasStake && verdict.confidence < CONFIDENCE_HIGH_MIN && verdict.verdict !== "UNRESOLVABLE") {
    verdict = {
      verdict: "UNRESOLVABLE",
      confidence: verdict.confidence,
      explanation: `[ORACLE HOLDS A POSITION — refunded below ${CONFIDENCE_HIGH_MIN}%] ${verdict.explanation}`.slice(0, 500),
      model: verdict.model,
    };
    adjustments.push(`oracle holds a position and confidence is below ${CONFIDENCE_HIGH_MIN}: refunded`);
  }

  console.log(`[settle] Decided by: ${rawVerdict.model ?? "unknown"} → ${verdict.verdict} (${verdict.confidence}%)`);
  return decisionFor(
    claim,
    verdict,
    {
      evidence: bundleEvidence(evidence),
      prices: prices && hasPrices ? bundlePrices(prices) : undefined,
      council: councilRecord,
      model: rawVerdict.model,
      rawVerdict: { verdict: rawVerdict.verdict, confidence: rawVerdict.confidence, explanation: rawVerdict.explanation },
      adjustments,
    },
    bonusVotes,
  );
}
