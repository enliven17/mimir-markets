import assert from "node:assert/strict";
import { test } from "node:test";

import { lateStakes, lateStakeSummary } from "../../lib/late-stakes";

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
  assert.match(lateStakeSummary(0, [{ at: 5 }, { at: 6 }]), /^Refunded: 2 stakes came in after the outcome was known \(1970-01-01 00:00 UTC\)/);
});
