import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_MARKET_RULES, impliedA, judgeMarkets, kellyStake, marketCandidates, pickStake, type MarketView } from "../../lib/launch/markets";
import type { JsonRouter } from "../../lib/launch/engine/rank";

const NOW = 1_800_000_000;
const pool = (over: Partial<MarketView> = {}): MarketView => ({
  kind: "pool", marketId: 1, question: "Will Lens beat Sporting CP?", labelA: "Yes", labelB: "No", category: "sports",
  deadline: NOW + 6 * 3600, lockAt: 0, usdcA: 3, usdcB: 1, status: "open", ...over,
});

test("candidates: open pools within the time window, in the agent's categories, not already held", () => {
  const ms = [
    pool({ marketId: 1 }),
    pool({ marketId: 2, kind: "vs" }),
    pool({ marketId: 3, status: "proposed" }),
    pool({ marketId: 4, deadline: NOW + 10 * 60 }),
    pool({ marketId: 5, deadline: NOW + 200 * 3600 }),
    pool({ marketId: 6, category: "crypto" }),
    pool({ marketId: 7 }),
    pool({ marketId: 8, deadline: NOW + 6 * 3600, lockAt: NOW + 5 * 60 }),
  ];
  const got = marketCandidates(ms, { ...DEFAULT_MARKET_RULES, categories: ["Sports"] }, new Set(["pool:7"]), NOW).map((m) => m.marketId);
  assert.deepEqual(got, [1]);
});

test("the pool's implied price is its stake split; an empty side reads as even", () => {
  assert.equal(impliedA({ usdcA: 3, usdcB: 1 }), 0.75);
  assert.equal(impliedA({ usdcA: 0, usdcB: 5 }), 0.5);
});

test("Kelly: no stake without an edge, more with a bigger one, never past the bankroll", () => {
  assert.equal(kellyStake(0.5, 1, 1, 100, 1), 0);
  const small = kellyStake(0.6, 1, 1, 100, 0.25), big = kellyStake(0.8, 1, 1, 100, 0.25);
  assert.ok(small > 0 && big > small && big <= 100);
});

test("pick: the side with the edge, sized and capped; nothing below the edge bar or the contract minimum", () => {
  const m = pool({ usdcA: 3, usdcB: 1 }); // implies A 75%, B 25%
  const pick = pickStake(new Map([[1, { pA: 0.5, why: "coin flip" }]]), [m], DEFAULT_MARKET_RULES, 20)!;
  assert.equal(pick.side, 2); // B is underpriced: 50% vs 25%
  assert.ok(Math.abs(pick.edge - 0.25) < 1e-9);
  assert.ok(pick.stakeUsdc >= 0.1 && pick.stakeUsdc <= DEFAULT_MARKET_RULES.maxStakeUsdc);
  assert.equal(pickStake(new Map([[1, { pA: 0.74, why: "" }]]), [m], DEFAULT_MARKET_RULES, 20), null); // no edge either way
  assert.equal(pickStake(new Map([[1, { pA: 0.5, why: "" }]]), [m], DEFAULT_MARKET_RULES, 0.2), null); // too small a budget
});

test("judge: keeps only known ids, clamps probabilities, and a failure means no judgement", async () => {
  const router = (data: unknown): JsonRouter => ({ async completeJson(_o, parse) { return { data: parse(data), provider: "test", model: "t" }; } });
  const got = await judgeMarkets(router({ markets: [{ id: 1, pA: 1.4, why: "sure" }, { id: 99, pA: 0.3 }] }), "", [pool()], NOW);
  assert.deepEqual([...got], [[1, { pA: 0.99, why: "sure" }]]);
  const failing: JsonRouter = { async completeJson() { throw new Error("429"); } };
  assert.equal((await judgeMarkets(failing, "", [pool()], NOW)).size, 0);
});
