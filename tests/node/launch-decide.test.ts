import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../../lib/launch/engine/decide";
import type { DecideInput } from "../../lib/launch/engine/decide";
import { mergeCandidates, enrichWith } from "../../lib/launch/engine/candidates";
import { WSOL_MINT } from "../../lib/launch/engine/sol";
import { cand, config, MINT_A, MINT_B, MINT_C, risk } from "../../lib/launch/engine/fixtures";

const SOL = 1_000_000_000n;
const input = (over: Partial<DecideInput> = {}): DecideInput => ({
  candidates: [cand(MINT_A, { symbol: "AAA" }), cand(MINT_B, { symbol: "BBB" })],
  conditions: config().entry,
  scores: new Map([[MINT_A, { score: 0.7, why: "ok" }], [MINT_B, { score: 0.9, why: "best" }]]),
  sizing: { spendable: 10n * SOL, bankrollLamports: 10n * SOL, risk: risk(), dailyPnl: 0n, openPositions: [] },
  ...over,
});

test("picks the best scored passing candidate and sizes it", () => {
  const r = decide(input());
  assert.equal(r.intent?.mint, MINT_B);
  assert.equal(r.intent?.lamports, SOL);
  assert.ok(r.lines.some((l) => l.text.includes("$BBB")));
});

test("a high score cannot rescue a candidate that failed the rules", () => {
  const r = decide(input({ candidates: [cand(MINT_A), cand(MINT_B, { metrics: { liquidityUsd: 1 } })] }));
  assert.equal(r.intent?.mint, MINT_A);
});

test("best score below threshold → no trade", () => {
  const r = decide(input({ threshold: 0.95 }));
  assert.equal(r.intent, null);
  assert.ok(r.lines.some((l) => /below threshold/.test(l.text)));
});

test("empty scores (ranker failed) → no trade", () => {
  assert.equal(decide(input({ scores: new Map() })).intent, null);
});

test("skips held mints, excluded mints, WSOL and unpriced candidates", () => {
  const held = decide(input({ sizing: { ...input().sizing, openPositions: [{ mint: MINT_B }] } }));
  assert.equal(held.intent?.mint, MINT_A);
  assert.equal(decide(input({ exclude: [MINT_B] })).intent?.mint, MINT_A);
  const unpriced = decide(input({ candidates: [cand(MINT_A, { priceSol: NaN }), cand(MINT_B, { priceSol: null })] }));
  assert.equal(unpriced.intent, null);
  const wsol = decide(input({ candidates: [cand(WSOL_MINT)], scores: new Map([[WSOL_MINT, { score: 1, why: "" }]]) }));
  assert.equal(wsol.intent, null);
});

test("daily cap propagates pause", () => {
  const r = decide(input({ sizing: { ...input().sizing, dailyPnl: -5n * SOL } }));
  assert.equal(r.intent, null);
  assert.equal(r.pause, true);
});

test("nothing passes → single rules line", () => {
  const r = decide(input({ conditions: [{ metric: "mentions1h", op: ">", value: 1 }] }));
  assert.equal(r.intent, null);
  assert.equal(r.lines[0].kind, "rules");
});

test("mergeCandidates unions metrics without overwriting, drops bad mints", () => {
  const merged = mergeCandidates([
    [cand(MINT_A, { symbol: "", priceSol: null, metrics: { mentions1h: 300 }, note: "x mentions" })],
    [cand(MINT_A, { symbol: "AAA", metrics: { liquidityUsd: 5, mentions1h: 1 } }), cand("not-a-mint")],
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].metrics, { mentions1h: 300, liquidityUsd: 5 });
  assert.equal(merged[0].symbol, "AAA");
  assert.equal(merged[0].priceSol, 0.001);
  const enriched = enrichWith([cand(MINT_C, { metrics: {} })], [cand(MINT_C, { metrics: { liquidityUsd: 9 } })]);
  assert.equal(enriched[0].metrics.liquidityUsd, 9);
});
