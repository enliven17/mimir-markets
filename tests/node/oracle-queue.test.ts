import test from "node:test";
import assert from "node:assert/strict";

import { orderDecisions, potTier, retryDelayMs, STARVE_SEC, type QueueMarket } from "../../lib/oracle-queue";

const W = 10n ** 18n;
const m = (id: number, usdc: number, deadline: number, creator = `0x${id}`): QueueMarket => ({
  kind: "vs",
  marketId: id,
  creator,
  deadline,
  pot: BigInt(Math.round(usdc * 1e6)) * 10n ** 12n,
});

test("pot tiers step by ×10 USDC", () => {
  assert.equal(potTier(W / 10n), 0);
  assert.equal(potTier(W), 1);
  assert.equal(potTier(9n * W), 1);
  assert.equal(potTier(10n * W), 2);
  assert.equal(potTier(150n * W), 3);
});

test("bigger pots first; within a tier the longest overdue first", () => {
  const now = 10_000;
  const out = orderDecisions([m(1, 0.2, 9_000), m(2, 50, 9_900), m(3, 0.3, 8_000), m(4, 60, 9_000)], 4, now);
  assert.deepEqual(out.map((x) => x.marketId), [4, 2, 3, 1]);
});

test("a spam flood from one creator takes at most two slots", () => {
  const now = 10_000;
  const spam = Array.from({ length: 1000 }, (_, i) => m(100 + i, 0.1, 9_000 - i, "0xspam"));
  const real = m(7, 0.1, 9_500, "0xreal");
  const out = orderDecisions([...spam, real], 3, now);
  assert.equal(out.filter((x) => x.creator === "0xspam").length, 2);
  assert.ok(out.some((x) => x.marketId === 7));
});

test("the most overdue market gets a slot once it starves, whatever its size", () => {
  const now = 100_000;
  const old = m(1, 0.1, now - STARVE_SEC - 1, "0xa");
  const big = Array.from({ length: 5 }, (_, i) => m(10 + i, 100, now - 60, `0xb${i}`));
  const out = orderDecisions([...big, old], 3, now);
  assert.equal(out[0].marketId, 1);
  assert.equal(out.length, 3);
});

test("deferrals back off exponentially, capped at 6 hours", () => {
  assert.equal(retryDelayMs(1), 2 * 60_000);
  assert.equal(retryDelayMs(3), 8 * 60_000);
  assert.equal(retryDelayMs(20), 360 * 60_000);
  assert.equal(retryDelayMs(3, 10), 8 * 60_000);
  assert.equal(retryDelayMs(7, 10), 10 * 60_000);
});
