/**
 * Per-instance memoization for expensive async reads (chain scans, RPC
 * fan-outs) that return values `unstable_cache` can't safely store, e.g.
 * bigint fields, which JSON.stringify throws on.
 *
 * Deduped per warm serverless instance only, not shared across instances.
 * That's an acceptable tradeoff here: it still collapses N concurrent/rapid
 * page views into one chain round-trip instead of N.
 *
 * Bounded: past `maxEntries` live keys the oldest insertion is evicted, so
 * caller-chosen arguments cannot grow the map without limit.
 */
export function cachedFor<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  ttlMs: number,
  maxEntries = 1_000
): (...args: Args) => Promise<T> {
  const cache = new Map<string, { value: Promise<T>; expiresAt: number }>();

  return (...args: Args) => {
    const key = JSON.stringify(args);
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value;
    }

    // Expired entries go when a new one comes in, so a long-lived instance
    // does not keep every argument combination it ever saw.
    const now = Date.now();
    for (const [k, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(k);
    }

    const value = fn(...args);
    cache.delete(key);
    cache.set(key, { value, expiresAt: now + ttlMs });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    // A failure is not cached: the next caller retries instead of being served
    // the same rejection for the whole TTL.
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    return value;
  };
}
