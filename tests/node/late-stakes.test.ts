import assert from "node:assert/strict";
import { test } from "node:test";

import { lateStakes, lateStakeSummary, settlementCutoff, settlementFunding } from "../../lib/late-stakes";

test("a stake at or after the moment the outcome was known is late; earlier ones are not", () => {
  const stakes = [{ at: 100 }, { at: 199 }, { at: 200 }, { at: 260 }];
  assert.deepEqual(lateStakes(200, stakes), [{ at: 200 }, { at: 260 }]);
  assert.deepEqual(lateStakes(300, stakes), []);
});

test("no known moment means nothing is late", () => {
  assert.deepEqual(lateStakes(null, [{ at: 1 }]), []);
  assert.deepEqual(lateStakes(Number.NaN, [{ at: 1 }]), []);
});

test("the summary says how many and when", () => {
  assert.match(lateStakeSummary(0, [{ at: 5 }, { at: 6 }]), /^Late deposits refunded: 2 stakes came in after the outcome was known \(1970-01-01 00:00 UTC\)/);
});

test("latest-event witnesses do not claim to be a complete count", () => {
  assert.match(lateStakeSummary(0, [{ at: 5 }], true), /^Late deposits refunded: at least 1 stake/);
});


test("settlement cutoff rejects unsafe times rather than skipping eligibility", () => {
  assert.equal(settlementCutoff(null, 100), 0);
  assert.equal(settlementCutoff(80, 100), 80);
  for (const time of [NaN, Infinity, -1, 0, 80.5, 101]) assert.throws(() => settlementCutoff(time, 100));
  assert.match(lateStakeSummary(80, [{ at: 100 }]), /Earlier stakes settle on the result/);
});


test("aggregated UI distinguishes partial refunds and no eligible opposition", () => {
  const market = { settlementCutoff: 80, stakeA: "10", stakeB: "12", eligibleA: "10", eligibleB: "10" };
  assert.equal(settlementFunding(market), "partial");
  assert.equal(settlementFunding({ ...market, eligibleB: "12" }), "all");
  assert.equal(settlementFunding({ ...market, eligibleB: "0" }), "refund");
  assert.equal(settlementFunding({ ...market, settlementCutoff: 0 }), "all");
});
