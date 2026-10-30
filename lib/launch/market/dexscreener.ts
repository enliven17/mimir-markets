// DexScreener: boosted/trending Solana tokens + pair metrics, also used to enrich candidates from
// other sources and as a fallback PriceFeed.
//
// Verified 2026-10-05 against https://docs.dexscreener.com/api/reference and live responses:
//   GET https://api.dexscreener.com/token-boosts/latest/v1   (60 req/min)  [{chainId, tokenAddress, description, amount, totalAmount, ...}]
//   GET https://api.dexscreener.com/token-boosts/top/v1      (60 req/min)  same shape
//   GET https://api.dexscreener.com/tokens/v1/{chainId}/{tokenAddresses} (300 req/min, ≤30 comma-separated addresses)
//       → [{baseToken:{address,symbol,name}, quoteToken:{address}, priceNative, priceUsd, volume:{h1},
//           liquidity:{usd}, marketCap, fdv, pairCreatedAt(ms)}]  — one entry per pair, token may be base or quote.
// priceNative is in units of the pair's quote token, so it is only SOL when the quote is wSOL.
import type { Candidate, MarketSource, PriceFeed } from "../ports";
import { isMint } from "../engine/candidates";
import { WSOL_MINT } from "../engine/sol";
import { chunk, getJson, num, ttlCache } from "./http";
import type { FetchLike, OnError } from "./http";

const BASE = "https://api.dexscreener.com";
const BATCH = 30;

export type DexOptions = {
  fetch?: FetchLike;
  now?: () => number;
  onError?: OnError;
  timeoutMs?: number;
  /** SOL price in USD, used to convert non-SOL-quoted pairs; undefined = leave priceSol null. */
  solUsd?: () => number | undefined;
  boostsTtlMs?: number;
  pairsTtlMs?: number;
  maxCandidates?: number;
};

type Pair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string };
  priceNative?: string;
  priceUsd?: string;
  volume?: { h1?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  pairCreatedAt?: number;
};
type Boost = { chainId?: string; tokenAddress?: string; description?: string; amount?: number; totalAmount?: number };

export type TokenSnapshot = Omit<Candidate, "source" | "note">;

export function createDexScreener(opts: DexOptions = {}) {
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? Date.now;
  const report = (err: unknown) => opts.onError?.("dexscreener", err);
  const boostCache = ttlCache<Boost[]>(opts.boostsTtlMs ?? 30_000, now);
  const pairCache = ttlCache<Map<string, TokenSnapshot>>(opts.pairsTtlMs ?? 15_000, now);
  const get = (path: string) => getJson(fetchFn, `${BASE}${path}`, { timeoutMs: opts.timeoutMs });

  function priceSol(p: Pair): number | null {
    const native = num(p.priceNative);
    if (p.quoteToken?.address === WSOL_MINT && native !== undefined && native > 0) return native;
    const usd = num(p.priceUsd);
    const sol = opts.solUsd?.();
    return usd !== undefined && usd > 0 && sol && sol > 0 ? usd / sol : null;
  }

  function snapshot(p: Pair, mint: string): TokenSnapshot {
    const created = num(p.pairCreatedAt);
    const age = created !== undefined ? (now() - created) / 60_000 : undefined;
    const metrics: Candidate["metrics"] = {};
    const set = (k: keyof Candidate["metrics"], v: number | undefined) => { if (v !== undefined && v >= 0) metrics[k] = v; };
    set("liquidityUsd", num(p.liquidity?.usd));
    set("volume1hUsd", num(p.volume?.h1));
    set("ageMinutes", age);
    set("mcapUsd", num(p.marketCap));
    return { mint, symbol: p.baseToken?.symbol ?? "", name: p.baseToken?.name, priceSol: priceSol(p), metrics, ...(p.pairAddress ? { pool: p.pairAddress } : {}) };
  }

  /** Best (most liquid) pair per mint where the mint is the base token. */
  async function lookupBatch(mints: string[]): Promise<Map<string, TokenSnapshot>> {
    const key = [...mints].sort().join(",");
    return pairCache.get(key, async () => {
      const body = await get(`/tokens/v1/solana/${mints.join(",")}`);
      const best = new Map<string, Pair>();
      for (const p of Array.isArray(body) ? (body as Pair[]) : []) {
        const mint = p?.baseToken?.address;
        if (!mint || !mints.includes(mint) || (p.chainId && p.chainId !== "solana")) continue;
        const prev = best.get(mint);
        if (!prev || (num(p.liquidity?.usd) ?? 0) > (num(prev.liquidity?.usd) ?? 0)) best.set(mint, p);
      }
      return new Map([...best].map(([m, p]) => [m, snapshot(p, m)]));
    });
  }

  /** Never throws; failed batches are reported and skipped. */
  async function lookup(mints: readonly string[]): Promise<Map<string, TokenSnapshot>> {
    const valid = [...new Set(mints.filter(isMint))];
    const out = new Map<string, TokenSnapshot>();
    const results = await Promise.allSettled(chunk(valid, BATCH).map(lookupBatch));
    for (const r of results) {
      if (r.status === "fulfilled") for (const [m, s] of r.value) out.set(m, s);
      else report(r.reason);
    }
    return out;
  }

  async function boosts(): Promise<Boost[]> {
    return boostCache.get("boosts", async () => {
      const lists = await Promise.allSettled([get("/token-boosts/top/v1"), get("/token-boosts/latest/v1")]);
      const all: Boost[] = [];
      for (const r of lists) {
        if (r.status === "fulfilled" && Array.isArray(r.value)) all.push(...(r.value as Boost[]));
        else if (r.status === "rejected") report(r.reason);
      }
      if (all.length === 0 && lists.every((r) => r.status === "rejected")) throw new Error("both boost lists failed");
      return all.filter((b) => b?.chainId === "solana" && isMint(b.tokenAddress));
    });
  }

  const source: MarketSource & { lookup: typeof lookup } = {
    id: "dexscreener",
    lookup,
    async candidates() {
      try {
        const list = await boosts();
        const byMint = new Map<string, Boost>();
        for (const b of list) if (!byMint.has(b.tokenAddress as string)) byMint.set(b.tokenAddress as string, b);
        const mints = [...byMint.keys()].slice(0, opts.maxCandidates ?? 60);
        const snaps = await lookup(mints);
        return mints.flatMap((m) => {
          const s = snaps.get(m);
          if (!s) return [];
          const b = byMint.get(m);
          const desc = typeof b?.description === "string" ? ` - ${b.description.slice(0, 120)}` : "";
          return [{ ...s, source: "dexscreener" as const, note: `boosted on DexScreener (${num(b?.totalAmount) ?? 0})${desc}` }];
        });
      } catch (err) {
        report(err);
        return [];
      }
    },
  };

  const prices: PriceFeed = {
    async prices(mints) {
      const snaps = await lookup(mints);
      const out = new Map<string, number>();
      for (const [m, s] of snaps) if (s.priceSol !== null && s.priceSol > 0) out.set(m, s.priceSol);
      return out;
    },
  };

  /** Fill missing metrics/price/symbol from pair data, never overwriting what a source already knew. */
  async function enrich(cands: readonly Candidate[]): Promise<Candidate[]> {
    const need = cands.filter((c) => c.priceSol === null || c.metrics.liquidityUsd === undefined || !c.symbol).map((c) => c.mint);
    if (need.length === 0) return [...cands];
    const snaps = await lookup(need);
    return cands.map((c) => {
      const s = snaps.get(c.mint);
      if (!s) return c;
      return { ...c, pool: c.pool ?? s.pool, symbol: c.symbol || s.symbol, name: c.name ?? s.name, priceSol: c.priceSol ?? s.priceSol, metrics: { ...s.metrics, ...c.metrics } };
    });
  }

  return { source, prices, enrich, lookup };
}
