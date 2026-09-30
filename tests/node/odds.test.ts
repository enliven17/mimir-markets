import test from "node:test";
import assert from "node:assert/strict";

import { impliedOdds, formatProbability, oddsBarWidths, crowdImbalance } from "../../lib/odds";

/** Stakes in whole USDC, converted to base units like the chain reports them. */
const split = (creator: number, challengers: number) => ({
  creatorStake: BigInt(Math.round(creator * 1e6)),
  totalChallengerStake: String(Math.round(challengers * 1e6)),
});

test("an evenly funded pool prices both sides at 50%", () => {
  const odds = impliedOdds(split(10, 10));
  assert.equal(odds.creatorProbability, 0.5);
  assert.equal(odds.challengerProbability, 0.5);
  assert.equal(odds.totalPot, 20);
  assert.equal(odds.unpriced, false);
});

test("money piling onto a side raises that side's implied probability", () => {
  const odds = impliedOdds(split(10, 30));
  assert.equal(odds.challengerProbability, 0.75);
  assert.equal(odds.creatorProbability, 0.25);
});

test("a crowded side pays less, and the payout matches the program's pro-rata share", () => {
  const crowded = impliedOdds(split(10, 30));
  assert.ok(crowded.challengerPayoutMultiple! < 1.5);

  const thin = impliedOdds(split(30, 10));
  assert.equal(thin.challengerPayoutMultiple, 4);
  assert.equal(thin.challengerProbability, 0.25);
});

test("an unchallenged claim has no price yet", () => {
  const odds = impliedOdds(split(10, 0));
  assert.equal(odds.unpriced, true);
  assert.equal(odds.creatorProbability, null);
  assert.equal(odds.challengerProbability, null);
  assert.equal(odds.challengerPayoutMultiple, null);
});

test("stakes already in USDC are accepted as-is", () => {
  const odds = impliedOdds({ creatorStake: 10, totalChallengerStake: 30 }, { inUsdc: true });
  assert.equal(odds.challengerProbability, 0.75);
});

test("junk stake fields do not produce NaN odds", () => {
  for (const s of [
    { creatorStake: "abc", totalChallengerStake: "5000000" },
    { creatorStake: -1, totalChallengerStake: "5000000" },
    { creatorStake: "1000000", totalChallengerStake: Number.NaN },
  ]) {
    const odds = impliedOdds(s);
    for (const value of [odds.creatorProbability, odds.challengerProbability]) {
      assert.ok(value === null || Number.isFinite(value), JSON.stringify(s));
    }
  }
});

test("probabilities always complement each other", () => {
  for (const [c, ch] of [[10, 30], [1, 99], [7, 3], [10, 10]]) {
    const odds = impliedOdds(split(c, ch));
    assert.ok(Math.abs(odds.creatorProbability! + odds.challengerProbability! - 1) < 1e-9);
  }
});

test("a null probability renders as a dash rather than zero", () => {
  assert.equal(formatProbability(null), "-");
  assert.equal(formatProbability(Number.NaN), "-");
  assert.equal(formatProbability(0.5), "50%");
  assert.equal(formatProbability(0.004), "0%");
  assert.equal(formatProbability(1), "100%");
});

test("bar widths always sum to 100 and keep a funded side visible", () => {
  for (const [c, ch] of [[1, 999], [999, 1], [10, 10], [3, 7]]) {
    const widths = oddsBarWidths(impliedOdds(split(c, ch)));
    assert.equal(widths.creator + widths.challenger, 100, `${c}/${ch}`);
    assert.ok(widths.creator >= 4 && widths.challenger >= 4, `${c}/${ch} collapsed a side`);
  }
});

test("an unpriced claim fills the bar with the creator side", () => {
  assert.deepEqual(oddsBarWidths(impliedOdds(split(10, 0))), { creator: 100, challenger: 0 });
});

test("imbalance runs from 0 at even money to 1 at one-sided", () => {
  assert.equal(crowdImbalance(impliedOdds(split(10, 10))), 0);
  const lopsided = crowdImbalance(impliedOdds(split(1, 99)));
  assert.ok(lopsided > 0.9 && lopsided <= 1);
  assert.equal(crowdImbalance(impliedOdds(split(10, 0))), 0);
});
