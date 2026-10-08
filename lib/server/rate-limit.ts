import { store, storeEnabled } from "./store";

/**
 * Fixed-window per-key request counter.
 *
 * With the backend configured the count lives there, shared across instances:
 * one atomic increment per check that both counts and reads. Without it (or
 * when the backend errors) the count falls back to this process's memory,
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

/**
 * Deploy-wide caps (`*-global` buckets) live apart from the per-client map:
 * a flood of fresh client keys evicts the oldest entries, and must not be
 * able to evict (reset) the global count with them. A handful of keys, never swept.
 */
const globalWindows = new Map<string, { windowStart: number; hits: number }>();

function allowInMemory(bucketKey: string, windowStart: number, limit: number, now: number): boolean {
  if (bucketKey.split(":")[0].endsWith("-global")) {
    const g = globalWindows.get(bucketKey);
    if (!g || g.windowStart !== windowStart) {
      globalWindows.set(bucketKey, { windowStart, hits: 1 });
      return 1 <= limit;
    }
    g.hits += 1;
    return g.hits <= limit;
  }
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
  if (!storeEnabled()) return allowInMemory(bucketKey, windowStart, limit, now);
  try {
    const [hits] = await store().tx([
      { op: "incr", t: "rate_limits", k: `${bucketKey}@${windowStart}`, field: "hits", d: { bucket_key: bucketKey, window_start: windowStart, hits: 0 }, at: windowStart },
    ]);
    return Number(hits ?? 0) <= limit;
  } catch (err) {
    console.warn(`[rate-limit] ${bucket} backend check failed, counting in memory:`, err);
    return allowInMemory(bucketKey, windowStart, limit, now);
  }
}

/** Old windows only matter to whatever job deletes them. */
export async function pruneRateLimits(olderThanMs = 86_400_000, now = Date.now()): Promise<void> {
  sweepMemory(now);
  // The backend sweeps its own old windows (convex/appStore.ts sweep); this is for an explicit cleanup.
  if (!storeEnabled()) return;
  await store().prune("rate_limits", now - olderThanMs);
}

/**
 * Proxies in front of the app that append to X-Forwarded-For (Railway's edge:
 * 1). The leftmost entries are whatever the client sent, so only the entry
 * this many hops from the right is trustworthy. 0 ignores the header.
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TRUSTED_PROXY_HOPS?.trim() || "1");
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

/**
 * The caller's IP as the trusted proxy reports it: never the leftmost
 * (client-controlled) X-Forwarded-For value, which let anyone rotate their
 * rate-limit key per request (audit P0-6).
 */
export function clientIp(req: Request, hops = trustedProxyHops()): string {
  if (hops > 0) {
    const parts = (req.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = parts.length >= hops ? parts[parts.length - hops] : "";
    if (ip) return rateKeyForIp(ip);
  }
  return rateKeyForIp(req.headers.get("x-real-ip")?.trim() || "unknown");
}

/** IPv6 hextets of an address, expanded ("::" filled), or null for anything that is not IPv6. */
function ipv6Hextets(ip: string): string[] | null {
  const addr = ip.replace(/^\[|\](:\d+)?$/g, "").split("%")[0].toLowerCase();
  if (!addr.includes(":") || /[^0-9a-f:.]/.test(addr)) return null;
  const [head, tail = ""] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = addr.includes("::") ? (tail ? tail.split(":") : []) : [];
  // An embedded IPv4 tail ("::ffff:1.2.3.4") counts as two hextets.
  const ends = (xs: string[]) => xs.flatMap((x) => (x.includes(".") ? ["0", "0"] : [x]));
  const filled = addr.includes("::") ? [...ends(h), ...Array(Math.max(0, 8 - ends(h).length - ends(t).length)).fill("0"), ...ends(t)] : ends(h);
  return filled.length === 8 ? filled.map((x) => (parseInt(x || "0", 16) || 0).toString(16)) : null;
}

/**
 * The key an IP is limited by: an IPv4 address as is, an IPv6 address by its /64 (one subscriber gets a whole /64,
 * so per-address limits would be free to rotate around). IPv4-mapped IPv6 counts as the IPv4 address.
 */
export function rateKeyForIp(ip: string): string {
  const mapped = /^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip.trim());
  if (mapped) return mapped[1];
  const hx = ipv6Hextets(ip.trim());
  return hx ? `${hx.slice(0, 4).join(":")}::/64` : ip.trim();
}

/** A wider network for shared ceilings: IPv4 /24, IPv6 /48. */
export function networkOf(key: string): string {
  const v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(key);
  if (v4) return `${v4[1]}.0/24`;
  const v6 = /^([0-9a-f]+:[0-9a-f]+:[0-9a-f]+):/.exec(key);
  return v6 ? `${v6[1]}::/48` : key;
}

/**
 * A per-minute limit from env (e.g. CLAIM_MODERATION_GLOBAL_PER_MIN), else
 * `fallback`. Used for the deploy-wide ceilings on LLM routes.
 */
export function envLimit(name: string, fallback: number, env: Record<string, string | undefined> = process.env): number {
  const n = Number(env[name]?.trim() || "");
  return Number.isInteger(n) && n > 0 ? n : fallback;
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
