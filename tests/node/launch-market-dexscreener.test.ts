import { test } from "node:test";
import assert from "node:assert/strict";
import { createDexScreener } from "../../lib/launch/market/dexscreener";
import { ttlCache } from "../../lib/launch/market/http";
import { MINT_A, MINT_B } from "../../lib/launch/engine/fixtures";
import { WSOL_MINT } from "../../lib/launch/engine/sol";

const NOW = 1_791_217_500_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Shapes copied from live responses (2026-10-05), trimmed.
const boost = (tokenAddress: string, chainId = "solana") => ({ url: "https://dexscreener.com/x", chainId, tokenAddress, description: "Super PePe X is going to Mars", amount: 10, totalAmount: 10 });
const pair = (base: string, quote: string, over: Record<string, unknown> = {}) => ({
  chainId: "solana",
  dexId: "raydium",
  pairAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
  baseToken: { address: base, name: "Bonk", symbol: "Bonk" },
  quoteToken: { address: quote, name: "Wrapped SOL", symbol: "SOL" },
  priceNative: "0.00000003203",
  priceUsd: "0.000003810",
  txns: { h1: { buys: 342, sells: 230 } },
  volume: { h24: 565356.53, h6: 123226.68, h1: 28740.45, m5: 1224.82 },
  liquidity: { usd: 429368.77, base: 72781267755, quote: 1278.34 },
  fdv: 338598658,
  marketCap: 335290411,
  pairCreatedAt: NOW - 90 * 60_000,
  ...over,
});

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected ${url}`);
    return routes[key]();
  };
  return { fetch, calls };
}

test("boosted solana tokens become candidates with mapped metrics", async () => {
  const { fetch, calls } = fakeFetch({
    "/token-boosts/top/v1": () => json([boost(MINT_A), boost("0x938C33755eA370764c6b17Abb2160436F196392B", "robinhood")]),
    "/token-boosts/latest/v1": () => json([boost(MINT_A)]),
    "/tokens/v1/solana/": () => json([pair(MINT_A, WSOL_MINT), pair(MINT_A, WSOL_MINT, { liquidity: { usd: 5 }, priceNative: "9" })]),
  });
  const dex = createDexScreener({ fetch, now: () => NOW });
  const out = await dex.source.candidates({ whales: [] });
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.mint, MINT_A);
  assert.equal(c.symbol, "Bonk");
  assert.equal(c.priceSol, 0.00000003203); // most liquid pair wins
  assert.deepEqual(c.metrics, { liquidityUsd: 429368.77, volume1hUsd: 28740.45, ageMinutes: 90, mcapUsd: 335290411 });
  assert.match(c.note ?? "", /boosted/);
  assert.equal(calls.filter((u) => u.includes("/tokens/v1/")).length, 1);
});

test("USDC-quoted pair converts via solUsd, otherwise priceSol stays null", async () => {
  const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const routes = { "/tokens/v1/solana/": () => json([pair(MINT_B, usdc, { priceUsd: "2", marketCap: undefined })]) };
  const withSol = createDexScreener({ fetch: fakeFetch(routes).fetch, now: () => NOW, solUsd: () => 100 });
  assert.equal((await withSol.prices.prices([MINT_B])).get(MINT_B), 0.02);
  const without = createDexScreener({ fetch: fakeFetch(routes).fetch, now: () => NOW });
  const snap = (await without.lookup([MINT_B])).get(MINT_B);
  assert.equal(snap?.priceSol, null);
  assert.equal(snap?.metrics.mcapUsd, undefined);
});

test("pairs where the mint is only the quote token are ignored", async () => {
  const { fetch } = fakeFetch({ "/tokens/v1/solana/": () => json([pair(WSOL_MINT, MINT_A)]) });
  assert.equal((await createDexScreener({ fetch }).lookup([MINT_A])).size, 0);
});

test("network errors and 429 never throw: [] and onError", async () => {
  const errors: string[] = [];
  const { fetch } = fakeFetch({ "/token-boosts/": () => json({ error: "slow down" }, 429), "/tokens/v1/": () => { throw new Error("ECONNRESET"); } });
  const dex = createDexScreener({ fetch, onError: (s, e) => errors.push(`${s}:${(e as Error).message}`) });
  assert.deepEqual(await dex.source.candidates({ whales: [] }), []);
  assert.equal((await dex.prices.prices([MINT_A])).size, 0);
  assert.ok(errors.some((e) => e.includes("429")));
  assert.ok(errors.some((e) => e.includes("ECONNRESET")));
});

test("enrich fills gaps only and batches by 30", async () => {
  const { fetch, calls } = fakeFetch({ "/tokens/v1/solana/": () => json([pair(MINT_A, WSOL_MINT)]) });
  const dex = createDexScreener({ fetch, now: () => NOW });
  const many = Array.from({ length: 31 }, (_, i) => ({ mint: i === 0 ? MINT_A : `${MINT_B.slice(0, 40)}${"abcdefghijkmnopqrstuvwxyzABCDEFGH"[i]}zzz`, symbol: "", source: "helius" as const, priceSol: null, metrics: { mentions1h: 5 } }));
  const out = await dex.enrich(many);
  assert.equal(calls.length, 2);
  assert.equal(out[0].symbol, "Bonk");
  assert.equal(out[0].metrics.mentions1h, 5);
  assert.equal(out[0].metrics.liquidityUsd, 429368.77);
});

test("ttlCache dedupes concurrent loads and does not cache failures", async () => {
  let t = 0;
  let loads = 0;
  const cache = ttlCache<number>(1000, () => t);
  const load = async () => { loads++; return loads; };
  const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
  assert.deepEqual([a, b, loads], [1, 1, 1]);
  t = 2000;
  assert.equal(await cache.get("k", load), 2);
  await assert.rejects(cache.get("x", async () => { throw new Error("boom"); }));
  assert.equal(await cache.get("x", async () => 7), 7);
});
