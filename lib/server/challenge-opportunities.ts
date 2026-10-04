/**
 * Challenge opportunities: source-backed claim drafts for the arena feed.
 *
 * Each configured source page (lib/challengeOpportunitySources.ts) is drafted
 * into claim candidates by the source-claim generator (one LLM call per
 * source), the best candidate per source is kept, scored on decidability
 * (lib/claimQuality.ts), and matched against the live claims: a candidate that
 * repeats an OPEN/ACTIVE claim becomes a "challenge this" link instead of a
 * "create" one. Curated seeds fill in when the generator is unavailable.
 *
 * Refreshed by the market-creator worker (agents/market-creator/opportunities.ts),
 * not a cron route: the worker is already running and already holds the chain
 * snapshot. Read by GET /api/challenge-opportunities. Without DATABASE_URL the
 * route serves the unexpired seeds only.
 */
import { CHALLENGE_OPPORTUNITY_SOURCES } from "@/lib/challengeOpportunitySources";
import { getSeedChallengeOpportunities } from "@/lib/challengeOpportunitySeeds";
import { computeClaimQuality } from "@/lib/claimQuality";
import type {
  ChallengeOpportunitiesResponse,
  ChallengeOpportunity,
  SourceClaimDraftCandidate,
} from "@/lib/claimDrafts";
import { normalizeResolutionSource } from "@/lib/constants";
import { mentionsPastDay } from "@/lib/past-date";
import { stripResolverFragment } from "@/lib/resolver-spec";
import { ST_ACTIVE, ST_OPEN } from "@/lib/solana/config";
import { getDb, isDbEnabled, query } from "./db";
import { readClaims } from "./solana-index";
import { generateClaimDrafts } from "./source-claim-generator";

const OPPORTUNITY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_OPPORTUNITIES_LIMIT = 24;
const DEFAULT_LIMIT = 8;

/** The live-claim fields matching needs (an index row or an on-chain claim maps onto it). */
export interface ExistingClaim {
  id: number;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  state: number;
  deadline: number;
}

function normalizeComparableText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sourceKey(url: string): string {
  return normalizeResolutionSource(stripResolverFragment(url));
}

export function scoreCandidate(candidate: SourceClaimDraftCandidate) {
  const quality = computeClaimQuality({
    question: candidate.claimText,
    creator_position: candidate.sideA,
    opponent_position: candidate.sideB,
    resolution_url: candidate.primaryResolutionSource,
    settlement_rule: candidate.settlementRule,
    category: candidate.category,
    deadline: Math.floor(Date.parse(candidate.deadlineAt) / 1000),
  });
  return {
    qualityScore: quality.score,
    qualityTier: quality.tier,
    combinedScore: quality.score + Math.round(candidate.confidenceScore / 5),
  };
}

function pickBestCandidate(candidates: SourceClaimDraftCandidate[]) {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const diff = scoreCandidate(b).combinedScore - scoreCandidate(a).combinedScore;
    return diff !== 0 ? diff : b.confidenceScore - a.confidenceScore;
  })[0]!;
}

/**
 * The live claim a candidate repeats: same resolution source (resolver
 * fragment ignored) and either the same question or the same two positions.
 */
export function findExistingOpportunityClaim(
  candidate: SourceClaimDraftCandidate,
  claims: ExistingClaim[],
  nowSec = Math.floor(Date.now() / 1000),
): ExistingClaim | undefined {
  const source = sourceKey(candidate.primaryResolutionSource);
  const question = normalizeComparableText(candidate.claimText);
  const sideA = normalizeComparableText(candidate.sideA);
  const sideB = normalizeComparableText(candidate.sideB);
  return claims
    .filter((c) => (c.state === ST_OPEN || c.state === ST_ACTIVE) && c.deadline > nowSec)
    .find((c) => {
      if (sourceKey(c.resolutionUrl) !== source) return false;
      if (normalizeComparableText(c.question) === question) return true;
      return (
        normalizeComparableText(c.creatorPosition) === sideA &&
        normalizeComparableText(c.counterPosition) === sideB
      );
    });
}

function toOpportunity(
  base: Pick<ChallengeOpportunity, "id" | "sourceUrl" | "sourceType" | "sourceSummary" | "candidate">,
  existing: ExistingClaim[],
): ChallengeOpportunity {
  const quality = scoreCandidate(base.candidate);
  const match = findExistingOpportunityClaim(base.candidate, existing);
  return {
    ...base,
    claimStrengthScore: quality.qualityScore,
    claimStrengthTier: quality.qualityTier,
    action: match ? "challenge" : "create",
    existingClaimId: match?.id,
  };
}

function dedupeOpportunities(opportunities: ChallengeOpportunity[]) {
  const seen = new Set<string>();
  return opportunities.filter((o) => {
    const key = `${sourceKey(o.sourceUrl)}|${normalizeComparableText(o.candidate.claimText)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function opportunityExpiresAt(candidate: SourceClaimDraftCandidate, generatedAt: number) {
  const deadlineAt = Date.parse(candidate.deadlineAt);
  if (!Number.isFinite(deadlineAt)) return generatedAt + OPPORTUNITY_TTL_MS;
  return Math.min(deadlineAt, generatedAt + OPPORTUNITY_TTL_MS);
}

/** Still worth suggesting: not about a day that is already over (its outcome is public). */
export function isCurrentOpportunity(o: ChallengeOpportunity, now = Date.now()): boolean {
  const c = o.candidate;
  return !mentionsPastDay(`${c.claimText} ${c.sideA} ${c.sideB}`, now);
}

/** Challenge links first, then the strongest, then the most confident. */
export function sortOpportunities(items: ChallengeOpportunity[]): ChallengeOpportunity[] {
  return [...items].sort((a, b) => {
    if (a.action !== b.action) return a.action === "challenge" ? -1 : 1;
    if (b.claimStrengthScore !== a.claimStrengthScore) return b.claimStrengthScore - a.claimStrengthScore;
    return b.candidate.confidenceScore - a.candidate.confidenceScore;
  });
}

/** Curated seeds whose deadline is still ahead. */
export function liveSeedOpportunities(existing: ExistingClaim[], now = Date.now()): ChallengeOpportunity[] {
  return getSeedChallengeOpportunities("en")
    .filter((seed) => opportunityExpiresAt(seed.candidate, now) > now)
    .map((seed) => toOpportunity(seed, existing));
}

export function indexRowsToExisting(
  rows: Array<{ id: number; question: string; creator_position: string; counter_position: string; resolution_url: string; state: number; deadline: number }>,
): ExistingClaim[] {
  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    creatorPosition: r.creator_position,
    counterPosition: r.counter_position,
    resolutionUrl: r.resolution_url,
    state: r.state,
    deadline: r.deadline,
  }));
}

async function existingFromIndex(): Promise<ExistingClaim[]> {
  try {
    return indexRowsToExisting(await readClaims({ states: [ST_OPEN, ST_ACTIVE], limit: 500 }));
  } catch {
    return [];
  }
}

/** Draft every source (one LLM call each), keep the best per source, add seeds. */
export async function buildChallengeOpportunities(existing: ExistingClaim[], now = Date.now()) {
  const drafted = await Promise.allSettled(
    CHALLENGE_OPPORTUNITY_SOURCES.map((source) => generateClaimDrafts({ sourceUrl: source.url, locale: "en" })),
  );
  const failures = drafted.filter((r) => r.status === "rejected").length;
  const generated = drafted.flatMap((result, index) => {
    if (result.status !== "fulfilled") return [];
    const best = pickBestCandidate(result.value.candidates);
    if (!best) return [];
    const source = CHALLENGE_OPPORTUNITY_SOURCES[index];
    return [
      toOpportunity(
        {
          id: `${source?.id ?? index}-${normalizeComparableText(best.claimText).slice(0, 48)}`,
          sourceUrl: result.value.sourceUrl,
          sourceType: result.value.sourceType,
          sourceSummary: result.value.sourceSummary,
          candidate: best,
        },
        existing,
      ),
    ];
  });
  const items = sortOpportunities(dedupeOpportunities([...generated, ...liveSeedOpportunities(existing, now)]))
    .filter((o) => opportunityExpiresAt(o.candidate, now) > now && isCurrentOpportunity(o, now));
  return { items, generated: generated.length, failures };
}

/** Replace the stored set in one transaction. */
export async function replaceChallengeOpportunities(items: ChallengeOpportunity[], generatedAt: number): Promise<void> {
  const pool = await getDb();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM challenge_opportunities");
    for (const o of items) {
      await client.query(
        `INSERT INTO challenge_opportunities
           (id, payload, action, claim_strength_score, confidence_score, generated_at, expires_at)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          o.id,
          JSON.stringify(o),
          o.action,
          o.claimStrengthScore,
          o.candidate.confidenceScore,
          generatedAt,
          opportunityExpiresAt(o.candidate, generatedAt),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Rebuild and store the index. `existing` defaults to the read index's live claims. */
export async function refreshChallengeOpportunitiesIndex(existing?: ExistingClaim[], now = Date.now()) {
  const { items, generated, failures } = await buildChallengeOpportunities(existing ?? (await existingFromIndex()), now);
  await replaceChallengeOpportunities(items, now);
  return { generatedAt: now, count: items.length, generated, failures };
}

export function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_OPPORTUNITIES_LIMIT, Math.floor(raw)));
}

/** Stored, unexpired opportunities; the live seeds when there is no DB or no rows yet. */
export async function getChallengeOpportunities(opts: { limit?: number; now?: number } = {}): Promise<ChallengeOpportunitiesResponse> {
  const now = opts.now ?? Date.now();
  const limit = clampLimit(opts.limit);
  if (isDbEnabled()) {
    try {
      const rows = await query<{ payload: ChallengeOpportunity | string; generated_at: string | number }>(
        `SELECT payload, generated_at FROM challenge_opportunities
          WHERE expires_at > $1
          ORDER BY CASE action WHEN 'challenge' THEN 0 ELSE 1 END,
                   claim_strength_score DESC, confidence_score DESC, generated_at DESC
          LIMIT $2`,
        [now, limit],
      );
      if (rows.length > 0) {
        // Stored before the past-day check existed, or the day ended since: filtered here too.
        const items = rows
          .map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as ChallengeOpportunity)
          .filter((o) => isCurrentOpportunity(o, now));
        const latest = rows.reduce((m, r) => Math.max(m, Number(r.generated_at) || 0), 0);
        return { items, count: items.length, generatedAt: latest > 0 ? new Date(latest).toISOString() : "" };
      }
    } catch (err) {
      console.warn("[challenge-opportunities] read failed, serving seeds:", err instanceof Error ? err.message : err);
    }
  }
  const items = sortOpportunities(liveSeedOpportunities(isDbEnabled() ? await existingFromIndex() : [], now)).slice(0, limit);
  return { items, count: items.length, generatedAt: "" };
}
