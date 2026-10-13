import { test } from "node:test";
import assert from "node:assert/strict";
import { createJupiterPrices, fallbackPrices, JUP_LITE_PRICE_URL, JUP_PRICE_URL } from "../../lib/launch/market/jupiter";
import { buysIn, createHeliusSource } from "../../lib/launch/market/helius";
import { MINT_A, MINT_B, MINT_C } from "../../lib/launch/engine/fixtures";
import { WSOL_MINT } from "../../lib/launch/engine/sol";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------- jupiter (shape from a live v3 response, 2026-10-05) ----------
const jup = (usd: Record<string, number>) =>
  json(Object.fromEntries(Object.entries(usd).map(([m, p]) => [m, { createdAt: "2024-06-05T08:55:25.527Z", liquidity: 1, usdPrice: p, blockId: 453633017, decimals: 9, priceChange24h: -1.9 }])));

test("jupiter: USD prices → SOL per token, key header, unknown mints omitted", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const feed = createJupiterPrices({ apiKey: "k1", fetch: async (url, init) => (calls.push({ url, init }), jup({ [WSOL_MINT]: 120, [MINT_A]: 0.6 })) });
  const out = await feed.prices([MINT_A, MINT_B]);
  assert.deepEqual([...out], [[MINT_A, 0.005]]);
  assert.equal(feed.solUsd(), 120);
  assert.ok(calls[0].url.startsWith(`${JUP_PRICE_URL}?ids=${WSOL_MINT},`));
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-api-key"], "k1");
});

test("jupiter: keyless uses lite host; no SOL price or HTTP error → empty, reported", async () => {
  const urls: string[] = [];
  const errors: unknown[] = [];
  const noSol = createJupiterPrices({ fetch: async (u) => (urls.push(u), jup({ [MINT_A]: 1 })) });
  assert.equal((await noSol.prices([MINT_A])).size, 0);
  assert.ok(urls[0].startsWith(JUP_LITE_PRICE_URL));
  const down = createJupiterPrices({ fetch: async () => json({ error: "x" }, 500), onError: (_s, e) => errors.push(e) });
  assert.equal((await down.prices([MINT_A])).size, 0);
  assert.equal(errors.length, 1);
});

test("fallbackPrices asks the fallback only for missing mints and survives throws", async () => {
  const asked: string[][] = [];
  const feed = fallbackPrices(
    { prices: async () => new Map([[MINT_A, 1]]) },
    { prices: async (m) => (asked.push(m), new Map([[MINT_B, 2]])) },
  );
  assert.deepEqual([...(await feed.prices([MINT_A, MINT_B]))], [[MINT_A, 1], [MINT_B, 2]]);
  assert.deepEqual(asked, [[MINT_B]]);
  const broken = fallbackPrices({ prices: async () => { throw new Error("x"); } }, { prices: async () => new Map([[MINT_A, 3]]) });
  assert.equal((await broken.prices([MINT_A])).get(MINT_A), 3);
});

// ---------- helius (EnhancedTransaction per the OpenAPI schema) ----------
const WHALE = "7xKpZqW1oG8bD5fVt1nHk3sYcR2mJ9aLqE4uTzXwPy6N";
const NOW = 1_791_217_500_000;
const swapTx = (over: Record<string, unknown> = {}) => ({
  description: "", type: "SWAP", source: "PUMP_FUN", fee: 5000, feePayer: WHALE,
  signature: "5sig", slot: 1, timestamp: NOW / 1000 - 120,
  nativeTransfers: [{ fromUserAccount: WHALE, toUserAccount: "Curve111111111111111111111111111111111111111", amount: 4_000_000_000 }],
  tokenTransfers: [{ fromUserAccount: "Curve111111111111111111111111111111111111111", toUserAccount: WHALE, fromTokenAccount: "a", toTokenAccount: "b", tokenAmount: 1234.5, mint: MINT_A, tokenStandard: "Fungible" }],
  accountData: [], events: {},
  ...over,
});

test("helius: detects a SOL→token buy, ignores sells and failed txs", () => {
  assert.deepEqual(buysIn(swapTx(), WHALE), [{ whale: WHALE, mint: MINT_A, sol: 4, at: NOW - 120_000, sig: "5sig" }]);
  const sell = swapTx({
    nativeTransfers: [{ fromUserAccount: "Curve111111111111111111111111111111111111111", toUserAccount: WHALE, amount: 4e9 }],
    tokenTransfers: [{ fromUserAccount: WHALE, toUserAccount: "Curve111111111111111111111111111111111111111", tokenAmount: 10, mint: MINT_A }],
  });
  assert.deepEqual(buysIn(sell, WHALE), []);
  assert.deepEqual(buysIn(swapTx({ transactionError: { error: "x" } }), WHALE), []);
  const viaWsol = swapTx({ nativeTransfers: [], tokenTransfers: [{ fromUserAccount: WHALE, toUserAccount: "pool", tokenAmount: 2, mint: WSOL_MINT }, { fromUserAccount: "pool", toUserAccount: WHALE, tokenAmount: 9, mint: MINT_B }] });
  assert.equal(buysIn(viaWsol, WHALE)[0].sol, 2);
});

test("helius: aggregates recent buys per mint, filters window/size, no key → []", async () => {
  const urls: string[] = [];
  const txs = [swapTx(), swapTx({ signature: "old", timestamp: NOW / 1000 - 3600 }), swapTx({ signature: "tiny", nativeTransfers: [{ fromUserAccount: WHALE, toUserAccount: "x", amount: 1_000_000 }], tokenTransfers: [{ toUserAccount: WHALE, tokenAmount: 1, mint: MINT_C }] })];
  const src = createHeliusSource({ apiKey: "secret", now: () => NOW, fetch: async (u) => (urls.push(u), json(txs)) });
  const out = await src.candidates({ whales: [WHALE, WHALE, "not a wallet"] });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/v0\/addresses\/7xKp.*\/transactions\?api-key=secret&gte-time=\d+&limit=50$/);
  assert.equal(out.length, 1);
  assert.equal(out[0].mint, MINT_A);
  assert.match(out[0].note ?? "", /1 whale \(7xKp…\) bought 4\.00 SOL, latest 2m ago/);
  assert.deepEqual(await createHeliusSource({ fetch: async () => json([]) }).candidates({ whales: [WHALE] }), []);
});

test("helius: HTTP error is reported with the key redacted", async () => {
  const errors: string[] = [];
  const src = createHeliusSource({ apiKey: "secret", fetch: async () => json({ msg: "bad key secret" }, 401), onError: (_s, e) => errors.push((e as Error).message) });
  assert.deepEqual(await src.candidates({ whales: [WHALE] }), []);
  assert.ok(errors[0].includes("401") && !errors[0].includes("secret"));
});

