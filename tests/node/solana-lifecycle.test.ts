import test from "node:test";
import assert from "node:assert/strict";

import {
  canFinalize,
  canRefundExpired,
  isDisputable,
  needsProposal,
  refundableAt,
  unpaidLegs,
  type LifecycleClaim,
} from "../../lib/solana/lifecycle";

const base: LifecycleClaim = {
  state: 1,
  winnerSide: 0,
  deadline: 1_000,
  creatorStake: 5n,
  totalChallengerStake: 5n,
  creatorPaid: false,
  challengers: [{ stake: 5n, paid: false }],
  resolutionGrace: 600,
  disputableUntil: 0,
  disputedAt: 0,
  bondState: 0,
};

test("an ACTIVE claim needs a proposal once its deadline passes", () => {
  assert.equal(needsProposal(base, 999), false);
  assert.equal(needsProposal(base, 1_000), true);
  assert.equal(needsProposal({ ...base, state: 4 }, 2_000), false);
});

test("a proposal is disputable until the window closes, then finalizable", () => {
  const p = { ...base, state: 4, disputableUntil: 2_000 };
  assert.equal(isDisputable(p, 1_999), true);
  assert.equal(canFinalize(p, 1_999), false);
  assert.equal(isDisputable(p, 2_000), false);
  assert.equal(canFinalize(p, 2_000), true);
});

test("refund_expired opens at deadline + grace, or dispute + grace", () => {
  assert.equal(refundableAt(base), 1_600);
  assert.equal(canRefundExpired(base, 1_599), false);
  assert.equal(canRefundExpired(base, 1_600), true);
  assert.equal(canRefundExpired({ ...base, state: 0 }, 1_600), true);
  const disputed = { ...base, state: 5, disputedAt: 1_500 };
  assert.equal(refundableAt(disputed), 2_100);
  assert.equal(canRefundExpired(disputed, 2_099), false);
  // PROPOSED has no hatch: finalize is permissionless.
  assert.equal(canRefundExpired({ ...base, state: 4 }, 10_000), false);
});

test("unpaid legs follow the verdict and include a returned bond", () => {
  assert.equal(unpaidLegs(base), 0, "nothing to pay before RESOLVED");
  assert.equal(unpaidLegs({ ...base, state: 2, winnerSide: 1 }), 1);
  assert.equal(unpaidLegs({ ...base, state: 2, winnerSide: 2 }), 1);
  assert.equal(unpaidLegs({ ...base, state: 2, winnerSide: 4 }), 2);
  assert.equal(unpaidLegs({ ...base, state: 2, winnerSide: 2, bondState: 2 }), 2);
  assert.equal(
    unpaidLegs({ ...base, state: 2, winnerSide: 4, creatorPaid: true, challengers: [{ stake: 5n, paid: true }] }),
    0
  );
});
