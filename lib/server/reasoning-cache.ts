/**
 * Memoizes council reasoning per (claim, persona).
 *
 * The prompt is built only from a claim's question and its two sides — all
 * immutable once the claim exists — so the same pair always regenerates the same
 * kind of text. In the source build 13K reads burned 22 minutes of active CPU (plus
 * 13K LLM calls) for four distinct pairs. Reads are free here, which makes the
 * cache (plus the route's rate limits) the only thing between a scraper and the
 * LLM bill.
 *
 * ponytail: per-instance Map. Fluid reuses instances so the hit rate is high; move
 * it to Neon only if cross-instance misses show up as real LLM spend.
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

export interface CachedReasoning {
  question: string;
  sideA: string;
  sideB: string;
  reasoning: string;
}

type Entry = CachedReasoning & { at: number };

const entries = new Map<string, Entry>();

const cacheKey = (claimId: number | string, slug: string) => `${claimId}:${slug}`;

export function getCachedReasoning(
  claimId: number | string,
  slug: string,
  nowMs = Date.now()
): CachedReasoning | null {
  const key = cacheKey(claimId, slug);
  const hit = entries.get(key);
  if (!hit) {
    return null;
  }
  if (nowMs - hit.at > TTL_MS) {
    entries.delete(key);
    return null;
  }

  return {
    question: hit.question,
    sideA: hit.sideA,
    sideB: hit.sideB,
    reasoning: hit.reasoning,
  };
}

export function setCachedReasoning(
  claimId: number | string,
  slug: string,
  value: CachedReasoning,
  nowMs = Date.now()
): void {
  const key = cacheKey(claimId, slug);
  // Re-insert so the key moves to the back of the eviction order.
  entries.delete(key);
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) {
      entries.delete(oldest);
    }
  }
  entries.set(key, { ...value, at: nowMs });
}

/** Test seam — production code never needs this. */
export function clearReasoningCache(): void {
  entries.clear();
}
