/**
 * Server-side RPC with failover. Free Helius keys have a monthly credit cap and a per-second rate
 * limit, so we keep several and move to the next one when a key answers 429 (rate limit), 401/403
 * (key disabled or monthly cap spent) or 5xx, or the request fails at the network level.
 *
 * Endpoints, in order: SOLANA_RPC (comma list of URLs), else one Helius URL per HELIUS_API_KEYS
 * (or the single HELIUS_API_KEY), then the public mainnet RPC as the last resort.
 * No `import "server-only"`: this also runs inside the Convex worker and under node --test.
 */
import { Connection, type Commitment } from "@solana/web3.js";

export const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
type Env = Record<string, string | undefined>;

const list = (raw: string | undefined) => [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];

export const heliusKeys = (env: Env = process.env) => list(env.HELIUS_API_KEYS || env.HELIUS_API_KEY);

export function rpcUrls(env: Env = process.env): string[] {
  const explicit = list(env.SOLANA_RPC);
  const urls = explicit.length ? explicit : heliusKeys(env).map((k) => `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(k)}`);
  return urls.includes(PUBLIC_RPC) ? urls : [...urls, PUBLIC_RPC];
}

/** How long an endpoint sits out after a failure. null = the response is fine, hand it back. */
export function cooldownMs(status: number | null): number | null {
  if (status === null) return 10_000; // network error / timeout
  if (status === 429) return 30_000;
  if (status === 401 || status === 403) return 60 * 60_000; // disabled key or monthly cap spent
  if (status >= 500) return 10_000;
  return null;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Clock = { now?: () => number };

/**
 * Failover over `targets` (URLs or keys): each call goes to the first target not cooling down and moves
 * on for the statuses above, trying every target at most once. Cooldowns persist across calls.
 */
function pool<C>(targets: string[], send: (target: string, init: RequestInit | undefined, ctx: C) => Promise<Response>, o: Clock = {}) {
  const now = o.now ?? Date.now;
  const until = new Map<string, number>();
  return async (init: RequestInit | undefined, ctx: C): Promise<Response> => {
    const t = now();
    const ready = targets.filter((x) => (until.get(x) ?? 0) <= t);
    const order = ready.length ? ready : [...targets].sort((a, b) => (until.get(a) ?? 0) - (until.get(b) ?? 0));
    let last: Response | null = null;
    let lastErr: unknown = null;
    for (const target of order) {
      try {
        const res = await send(target, init, ctx);
        const cool = cooldownMs(res.status);
        if (cool === null) return res;
        until.set(target, now() + cool);
        last = res;
      } catch (err) {
        until.set(target, now() + (cooldownMs(null) ?? 0));
        lastErr = err;
      }
    }
    if (last) return last;
    throw lastErr instanceof Error ? lastErr : new Error("all RPC endpoints failed");
  };
}

/** A fetch for web3.js Connection: ignores the URL it is given and walks the endpoint pool instead. */
export function failoverFetch(urls: string[], o: Clock & { fetch?: Fetch } = {}): Fetch {
  const doFetch = o.fetch ?? ((u, i) => fetch(u, i));
  const call = pool<null>(urls, (u, i) => doFetch(u, i), o);
  return (_input, init) => call(init, null);
}

/** A Connection over the whole pool. The first URL only names it (and derives the websocket URL). */
export function rpcConnection(commitment: Commitment = "confirmed", env: Env = process.env): Connection {
  const urls = rpcUrls(env);
  return new Connection(urls[0], { commitment, fetch: failoverFetch(urls) as never });
}

// ---------------- money paths: one endpoint per transaction ----------------
//
// Failover is right for reads and wrong for a transaction's lifecycle: once bytes may have been
// forwarded, a second endpoint that lags ("Blockhash not found", no status yet) would make a landed tx
// look dead and get it paid again. So a tx's blockhash, sends, status polling and expiry check all go
// to ONE endpoint (pickEndpoint), and the other endpoints are only asked for history as a second
// opinion before anything is declared "not landed" (lib/server/solana/tx.ts settleSignature).
// The public RPC is never used here: it prunes history and rate-limits hard.

/** Keyed endpoints only (rpcUrls without the public RPC), in configured order. */
export const moneyUrls = (env: Env = process.env): string[] => rpcUrls(env).filter((u) => u !== PUBLIC_RPC);

type Health = { until: Map<string, number>; now: () => number };

/**
 * A Connection pinned to `url`: no failover, no silent 429 retries. A failing status or network error
 * cools the endpoint in `health` (shared with stickyPool) so the NEXT transaction picks another one.
 */
export function rpcConnectionFor(url: string, commitment: Commitment = "confirmed", o: { fetch?: Fetch; health?: Health } = {}): Connection {
  const doFetch = o.fetch ?? ((u, i) => fetch(u, i));
  const cool = (ms: number | null) => {
    if (ms !== null && o.health) o.health.until.set(url, o.health.now() + ms);
  };
  const pinned: Fetch = async (_input, init) => {
    try {
      const res = await doFetch(url, init);
      cool(cooldownMs(res.status));
      return res;
    } catch (err) {
      cool(cooldownMs(null));
      throw err;
    }
  };
  return new Connection(url, { commitment, fetch: pinned as never, disableRetryOnRateLimit: true });
}

export type StickyEndpoint = { url: string; connection: Connection; witnesses: Connection[] };

/**
 * One pinned Connection per keyed endpoint, sharing cooldowns. pickEndpoint() = the endpoint a new
 * transaction lives on (first one not cooling down, else the one that recovers first) plus the others
 * as witnesses; null when no keyed endpoint is configured (then nothing may be sent). Keep one per process.
 */
export function stickyPool(env: Env = process.env, o: Clock & { fetch?: Fetch } = {}) {
  const urls = moneyUrls(env);
  const health: Health = { until: new Map(), now: o.now ?? Date.now };
  const conns = new Map(urls.map((u) => [u, rpcConnectionFor(u, "confirmed", { fetch: o.fetch, health })]));
  const others = (url: string) => urls.filter((u) => u !== url).map((u) => conns.get(u)!);
  return {
    urls,
    pickEndpoint(): StickyEndpoint | null {
      if (!urls.length) return null;
      const t = health.now();
      const url = urls.find((u) => (health.until.get(u) ?? 0) <= t) ?? [...urls].sort((a, b) => (health.until.get(a) ?? 0) - (health.until.get(b) ?? 0))[0];
      return { url, connection: conns.get(url)!, witnesses: others(url) };
    },
    /** Every keyed endpoint (reconciling a signature asks them all). */
    all: (): Connection[] => urls.map((u) => conns.get(u)!),
  };
}
export type StickyPool = ReturnType<typeof stickyPool>;

/**
 * Helius REST/DAS with failover across keys: `call(key => url, init)`. Keep one per process so
 * cooldowns stick. Throws when no key is configured.
 */
export function heliusClient(env: Env = process.env, o: Clock & { fetch?: Fetch } = {}) {
  const keys = heliusKeys(env);
  if (!keys.length) throw new Error("HELIUS_API_KEYS is not set");
  const doFetch = o.fetch ?? ((u, i) => fetch(u, i));
  const call = pool<(key: string) => string>(keys, (k, i, urlFor) => doFetch(urlFor(k), i), o);
  return (urlFor: (key: string) => string, init?: RequestInit) => call(init, urlFor);
}
