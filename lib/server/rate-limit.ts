import { isDbEnabled, query } from "./db";

/**
 * Fixed-window per-key request counter.
 *
 * With DATABASE_URL set the count lives in Postgres, shared across instances:
 * one statement per check, the upsert both counts and reads. Without it (or
 * when the database errors) the count falls back to this process's memory,
 * which still caps a single flooding client on a single instance.
 */

const memoryWindows = new Map<string, { windowStart: number; hits: number }>();
const MEMORY_MAX_KEYS = 10_000;

function sweepMemory(now: number): void {
  for (const [key, entry] of memoryWindows) {
    // Anything older than a day is dead for every window size we use.
    if (entry.windowStart < now - 86_400_000) memoryWindows.delete(key);
  }
  // Still over the cap: drop the oldest insertions (Map keeps insertion order).
  while (memoryWindows.size > MEMORY_MAX_KEYS) {
    const oldest = memoryWindows.keys().next().value;
    if (oldest === undefined) break;
    memoryWindows.delete(oldest);
  }
}

function allowInMemory(bucketKey: string, windowStart: number, limit: number, now: number): boolean {
  const entry = memoryWindows.get(bucketKey);
  if (!entry || entry.windowStart !== windowStart) {
    memoryWindows.delete(bucketKey);
    memoryWindows.set(bucketKey, { windowStart, hits: 1 });
    if (memoryWindows.size > MEMORY_MAX_KEYS) sweepMemory(now);
    return 1 <= limit;
  }
  entry.hits += 1;
  return entry.hits <= limit;
}

export async function allowRequest(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const bucketKey = `${bucket}:${key}`;
  if (!isDbEnabled()) return allowInMemory(bucketKey, windowStart, limit, now);
  try {
    const rows = await query<{ hits: number }>(
      `INSERT INTO rate_limits (bucket_key, window_start, hits) VALUES ($1, $2, 1)
       ON CONFLICT (bucket_key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits`,
      [bucketKey, windowStart],
    );
    return Number(rows[0]?.hits ?? 0) <= limit;
  } catch (err) {
    console.warn(`[rate-limit] ${bucket} db check failed, counting in memory:`, err);
    return allowInMemory(bucketKey, windowStart, limit, now);
  }
}

/** Old windows only matter to whatever job deletes them. */
export async function pruneRateLimits(olderThanMs = 86_400_000, now = Date.now()): Promise<void> {
  sweepMemory(now);
  if (!isDbEnabled()) return;
  await query("DELETE FROM rate_limits WHERE window_start < $1", [now - olderThanMs]);
}

/** The caller's IP as the platform proxy reports it. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: "rate_limited", message: "Too many requests, slow down and try again shortly." },
    }),
    { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfterSec) } },
  );
}

/** Test hook: forget every in-memory window. */
export function resetMemoryRateLimits(): void {
  memoryWindows.clear();
}
