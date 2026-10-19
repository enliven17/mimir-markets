/**
 * Candidates for a Robinhood agent from GeckoTerminal (free, no key, ~30 req/min; one cached call serves every
 * agent). Verified 2026-10-19 against live responses:
 *   GET https://api.geckoterminal.com/api/v2/networks/robinhood/dexes/pons-v2/pools?sort=h24_volume_usd_desc
 *       Pons tokens still on their bonding curve (pool address = the curve)
 *   GET .../dexes/pons-v2-dex/pools?sort=h24_volume_usd_desc   Pons tokens graduated into their Uniswap v4 pool
 *   GET https://api.geckoterminal.com/api/v2/networks/robinhood/new_pools   every dex, newest first: the fresh Pons
 *       launches (the per-dex list only sorts by volume or tx count)
 *   → data[].attributes {base_token_price_native_currency (ETH per token), reserve_in_usd, volume_usd.h1, fdv_usd,
 *     pool_created_at, transactions.h1}, relationships.base_token.data.id = "robinhood_<address>"
 * The engine's source ids are reused: "pumpfun" is the Pons launchpad (curve tokens), "dexscreener" the graduated ones.
 * curvePct is real ETH raised over the 4.2 ETH graduation threshold, from reserve_in_usd and the ETH price GT reports.
 */
import { getAddress, isAddress } from "viem";

import type { Candidate, MarketSource } from "../ports";
import { getJson, num, ttlCache, type FetchLike, type OnError } from "../market/http";

const BASE = "https://api.geckoterminal.com/api/v2/networks/robinhood/dexes";
const NEW_POOLS = "https://api.geckoterminal.com/api/v2/networks/robinhood/new_pools";
/** Phantom quote (1.68 ETH) plus the 4.2 ETH threshold: a curve's quote reserve when it graduates. */
const CURVE_FULL_ETH = 5.88;
const PHANTOM_ETH = 1.68;

type Pool = {
  attributes?: {
    name?: string;
    base_token_price_native_currency?: string;
    quote_token_price_usd?: string;
    reserve_in_usd?: string;
    fdv_usd?: string;
    pool_created_at?: string;
    volume_usd?: { h1?: string };
    transactions?: { h1?: { buys?: number; sells?: number } };
  };
  relationships?: { base_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } };
};

export function toCandidate(p: Pool, source: "pumpfun" | "dexscreener", now: number): Candidate | null {
  const a = p.attributes ?? {};
  const raw = p.relationships?.base_token?.data?.id?.replace(/^robinhood_/, "");
  if (!raw || !isAddress(raw, { strict: false })) return null;
  const created = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN;
  const liquidityUsd = num(a.reserve_in_usd);
  const ethUsd = num(a.quote_token_price_usd);
  const metrics: Candidate["metrics"] = {
    liquidityUsd,
    volume1hUsd: num(a.volume_usd?.h1),
    mcapUsd: num(a.fdv_usd),
    ageMinutes: Number.isFinite(created) ? Math.max(0, (now - created) / 60_000) : undefined,
  };
  if (source === "pumpfun" && liquidityUsd !== undefined && ethUsd) {
    // GT counts the curve's quote reserve with its phantom part; strip it to get the ETH really raised.
    metrics.curvePct = Math.min(100, Math.max(0, ((liquidityUsd / ethUsd - PHANTOM_ETH) / (CURVE_FULL_ETH - PHANTOM_ETH)) * 100));
  }
  const tx = a.transactions?.h1;
  return {
    mint: getAddress(raw),
    symbol: (a.name ?? "").split(" / ")[0]?.trim() || raw.slice(0, 6),
    source,
    priceSol: num(a.base_token_price_native_currency) ?? null,
    metrics,
    note: tx ? `${tx.buys ?? 0} buys / ${tx.sells ?? 0} sells in the last hour on ${source === "pumpfun" ? "the Pons curve" : "its Uniswap pool"}` : undefined,
  };
}

export function createPonsSources(opts: { fetch?: FetchLike; onError?: OnError; now?: () => number; ttlMs?: number } = {}) {
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? Date.now;
  const cache = ttlCache<Pool[]>(opts.ttlMs ?? 60_000, now);
  const pools = (url: string) => cache.get(url, async () => ((await getJson(fetchFn, url)) as { data?: Pool[] }).data ?? []);
  const load = async (dex: "pons-v2" | "pons-v2-dex", source: "pumpfun" | "dexscreener") => {
    const busiest = await pools(`${BASE}/${dex}/pools?page=1&sort=h24_volume_usd_desc`);
    // The curve list also takes the newest launches, which volume sorting never surfaces.
    // A failed newest-pools call (429) must not cost the busiest list: it is reported and skipped.
    const newest = dex === "pons-v2" ? await pools(`${NEW_POOLS}?page=1`).catch((err) => (opts.onError?.("geckoterminal:new_pools", err), [] as Pool[])) : [];
    const fresh = newest.filter((p) => p.relationships?.dex?.data?.id === "pons-v2");
    return [...fresh, ...busiest].map((p) => toCandidate(p, source, now())).filter((c): c is Candidate => c !== null);
  };
  const source = (id: "pumpfun" | "dexscreener", dex: "pons-v2" | "pons-v2-dex"): MarketSource => ({
    id,
    async candidates() {
      try {
        return await load(dex, id);
      } catch (err) {
        opts.onError?.(`geckoterminal:${dex}`, err);
        return [];
      }
    },
  });
  return { curve: source("pumpfun", "pons-v2"), graduated: source("dexscreener", "pons-v2-dex") };
}
