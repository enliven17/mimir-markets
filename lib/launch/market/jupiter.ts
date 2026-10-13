// Jupiter Price API v3 as the primary PriceFeed (SOL per whole token).
//
// Verified 2026-10-05 against https://dev.jup.ag/docs/price/v3 and live calls:
//   GET https://api.jup.ag/price/v3?ids=<comma-separated mints>   header x-api-key (keys: https://developers.jup.ag/portal)
//   GET https://lite-api.jup.ag/price/v3?ids=...                  keyless tier (answered 200 on 2026-10-05)
//   → { [mint]: { usdPrice, blockId, decimals, priceChange24h, liquidity, createdAt } }
//   Up to 50 ids per call; tokens without a reliable price are omitted entirely.
// Prices are USD, so SOL per token = usdPrice(mint) / usdPrice(wSOL); wSOL rides along in every batch.
import type { PriceFeed } from "../ports";
import { isMint } from "../engine/candidates";
import { WSOL_MINT } from "../engine/sol";
import { chunk, getJson, num, ttlCache } from "./http";
import type { FetchLike, OnError } from "./http";

export const JUP_PRICE_URL = "https://api.jup.ag/price/v3";
export const JUP_LITE_PRICE_URL = "https://lite-api.jup.ag/price/v3";
const BATCH = 49; // + wSOL = 50

export type JupiterOptions = { apiKey?: string; baseUrl?: string; fetch?: FetchLike; now?: () => number; onError?: OnError; timeoutMs?: number; ttlMs?: number };

export function createJupiterPrices(opts: JupiterOptions = {}): PriceFeed & { solUsd(): number | undefined } {
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  const base = opts.baseUrl ?? (opts.apiKey ? JUP_PRICE_URL : JUP_LITE_PRICE_URL);
  const cache = ttlCache<Map<string, number>>(opts.ttlMs ?? 5_000, opts.now);
  let lastSolUsd: number | undefined;

  async function usdBatch(mints: string[]): Promise<Map<string, number>> {
    const ids = [WSOL_MINT, ...mints.filter((m) => m !== WSOL_MINT)];
    return cache.get(ids.slice().sort().join(","), async () => {
      const body = (await getJson(fetchFn, `${base}?ids=${ids.join(",")}`, {
        timeoutMs: opts.timeoutMs,
        headers: opts.apiKey ? { "x-api-key": opts.apiKey } : {},
        redact: opts.apiKey,
      })) as Record<string, { usdPrice?: unknown } | null> | null;
      const out = new Map<string, number>();
      for (const id of ids) {
        const usd = num(body?.[id]?.usdPrice);
        if (usd !== undefined && usd > 0) out.set(id, usd);
      }
      return out;
    });
  }

  return {
    solUsd: () => lastSolUsd,
    async prices(mints) {
      const out = new Map<string, number>();
      const valid = [...new Set(mints.filter(isMint))];
      const batches = valid.length ? chunk(valid, BATCH) : [[]];
      const results = await Promise.allSettled(batches.map(usdBatch));
      for (const r of results) {
        if (r.status === "rejected") {
          opts.onError?.("jupiter", r.reason);
          continue;
        }
        const sol = r.value.get(WSOL_MINT);
        if (!sol) continue; // no SOL price → can't convert this batch
        lastSolUsd = sol;
        for (const [mint, usd] of r.value) if (valid.includes(mint)) out.set(mint, mint === WSOL_MINT ? 1 : usd / sol);
      }
      return out;
    },
  };
}

/** Ask `primary` first, then `fallback` for whatever it didn't know. Never throws. */
export function fallbackPrices(primary: PriceFeed, fallback: PriceFeed, onError?: OnError): PriceFeed {
  const safe = async (feed: PriceFeed, mints: string[]) => {
    try {
      return await feed.prices(mints);
    } catch (err) {
      onError?.("prices", err);
      return new Map<string, number>();
    }
  };
  return {
    async prices(mints) {
      const out = await safe(primary, mints);
      const missing = mints.filter((m) => !out.has(m));
      if (missing.length) for (const [m, p] of await safe(fallback, missing)) out.set(m, p);
      return out;
    },
  };
}
