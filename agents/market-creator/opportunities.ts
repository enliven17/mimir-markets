/**
 * Rebuild the arena's challenge-opportunity index from the market-creator
 * worker (in place of the source build's Vercel cron route).
 *
 * Runs at most every CHALLENGE_OPPORTUNITIES_REFRESH_MS (default 6h): one LLM
 * call per configured source page. The last run time is kept in app_meta, so
 * a worker restart does not re-draft everything. A no-op without
 * NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS=1, a DATABASE_URL or a GEMINI_API_KEY
 * (the generator's own requirement). Never throws: a failed refresh leaves
 * the previous set in place.
 */
import type { OnchainClaim } from "../../lib/solana/client";
import { getMeta, isDbEnabled, setMeta } from "../../lib/server/db";
import { refreshChallengeOpportunitiesIndex, type ExistingClaim } from "../../lib/server/challenge-opportunities";

const REFRESH_MS = Number(process.env.CHALLENGE_OPPORTUNITIES_REFRESH_MS ?? String(6 * 3_600_000));
const META_KEY = "challenge_opportunities_refreshed_at";

export function opportunitiesEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS === "1" &&
    isDbEnabled() &&
    Boolean(process.env.GEMINI_API_KEY?.trim())
  );
}

export function toExisting(claims: OnchainClaim[]): ExistingClaim[] {
  return claims.map((c) => ({
    id: Number(c.id),
    question: c.question,
    creatorPosition: c.creatorPosition,
    counterPosition: c.counterPosition,
    resolutionUrl: c.resolutionUrl,
    state: c.state,
    deadline: c.deadline,
  }));
}

export async function refreshOpportunitiesFromWorker(claims: OnchainClaim[], dryRun: boolean, now = Date.now()): Promise<void> {
  if (!opportunitiesEnabled() || REFRESH_MS <= 0) return;
  try {
    const last = Number((await getMeta(META_KEY)) ?? 0);
    if (now - last < REFRESH_MS) return;
    if (dryRun) {
      console.log("[creator] (dry run) challenge opportunities due for a refresh — skipped");
      return;
    }
    const r = await refreshChallengeOpportunitiesIndex(toExisting(claims), now);
    await setMeta(META_KEY, String(now), now);
    console.log(
      `[creator] challenge opportunities refreshed: ${r.count} stored (${r.generated} drafted, ${r.failures} source failures)`,
    );
  } catch (err) {
    console.warn("[creator] challenge opportunities refresh failed:", err instanceof Error ? err.message : err);
  }
}
