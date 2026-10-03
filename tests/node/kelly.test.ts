import assert from "node:assert/strict";
import test from "node:test";

import { kellyFraction } from "../../lib/kelly";

test("no edge at 50% confidence on even odds", () => {
  assert.equal(kellyFraction(50, 0.25), 0);
});

test("negative edge clamps to zero, never a negative bet", () => {
  assert.equal(kellyFraction(30, 0.25), 0);
  assert.equal(kellyFraction(0, 0.25), 0);
});

test("positive edge below the cap returns the raw Kelly fraction", () => {
  // p=0.6, q=0.4, b=1 → f = 0.2
  assert.ok(Math.abs(kellyFraction(60, 1.0) - 0.2) < 1e-12);
});

test("the cap bounds aggressive edges", () => {
  // p=0.8 → raw f = 0.6, capped per caller
  assert.equal(kellyFraction(80, 0.25), 0.25);
  assert.equal(kellyFraction(80, 0.15), 0.15);
});

test("100% confidence bets exactly the cap", () => {
  assert.equal(kellyFraction(100, 0.25), 0.25);
});

test("challenger odds come from the pool: creatorStake / (challengers + stake)", async () => {
  const { challengerNetOdds } = await import("../../lib/kelly");
  assert.equal(challengerNetOdds(10, 0, 10), 1);
  assert.equal(challengerNetOdds(2, 0, 100), 0.02);
  assert.equal(challengerNetOdds(0, 0, 5), 0);
});

test("pool-odds Kelly refuses the audit's -EV bet and caps at the creator stake", async () => {
  const { challengerKellyStake } = await import("../../lib/kelly");
  // 2 USDC creator stake, 80% confidence, big bankroll: b collapses as the stake grows.
  const s = challengerKellyStake({ confidencePct: 80, cap: 0.25, bankroll: 1000, creatorStake: 2, totalChallengerStake: 0 });
  assert.ok(s <= 2 + 1e-9, `stake ${s} capped at 1x the creator stake`);
  assert.ok(s > 0);
  // Already crowded: 2 creator vs 100 challengers → no edge even at 80%.
  assert.equal(challengerKellyStake({ confidencePct: 80, cap: 0.25, bankroll: 1000, creatorStake: 2, totalChallengerStake: 100, minStake: 2 }), 0);
  // Even money pool, 60%: f* = 0.2 of a 50 bankroll = 10, cap 1x creator = 100 doesn't bind, Kelly does.
  const even = challengerKellyStake({ confidencePct: 60, cap: 1, bankroll: 50, creatorStake: 100, totalChallengerStake: 90, maxCreatorMultiple: 1 });
  assert.ok(even > 0 && even < 10.01, `kelly-bounded stake ${even}`);
  // The stake stays Kelly-consistent at its own odds.
  const b = 100 / (90 + even);
  assert.ok(even <= 50 * ((0.6 * b - 0.4) / b) + 1e-6);
});

test("the program minimum is staked only when it is still +EV", async () => {
  const { challengerKellyStake } = await import("../../lib/kelly");
  // Bankroll 8: Kelly wants 1.25, but 2 USDC is still +EV at b = 10 / 2 = 5.
  assert.equal(challengerKellyStake({ confidencePct: 25, cap: 0.25, bankroll: 4, creatorStake: 10, totalChallengerStake: 0, minStake: 2, maxCreatorMultiple: 1 }) , 0, "2 > 0.25 × 4 ceiling");
  assert.equal(challengerKellyStake({ confidencePct: 25, cap: 0.25, bankroll: 8, creatorStake: 10, totalChallengerStake: 0, minStake: 2 }), 2);
});
