import test from "node:test";
import assert from "node:assert/strict";

import {
  splitFees,
  validateFeePolicy,
  noWinnerLosesPrincipal,
  conservationHolds,
  creatorGross,
  challengerGross,
  InvalidFeePolicyError,
  DEFAULT_FEE_POLICY,
  MAX_TOTAL_FEE_BPS,
  type FeePolicy,
} from "../../lib/solana/fees";

// Same vectors as onchain/programs/mimir/src/math.rs; the two must agree.
const USDC = 1_000_000n;
const PLATFORM = "J98R1EtNppvAFPXrviBUhFZbxoDpTCL7vjBwDRxVpKyk";
const AGENT = "HSLzwpPrgUKv95T5ze1urJUKhmbmkiz3Rck6YEjFY1x2";
const WINNER = "Dwccu8jjqMzggSHRiXJq9Vok6xMosbwYu6mU3zGdSuKR";
const NONE = "11111111111111111111111111111111";

const policy: FeePolicy = { ...DEFAULT_FEE_POLICY, platformRecipient: PLATFORM };

test("fees are charged on profit, never on principal", () => {
  const split = splitFees({ gross: 30n * USDC, principal: 10n * USDC, policy, winner: WINNER, agentOwner: AGENT });
  assert.equal(split.profit, 20n * USDC);
  assert.equal(split.platformFee, 100_000n);
  assert.equal(split.agentOwnerFee, 100_000n);
  assert.equal(split.netPayout, 29_800_000n);
  assert.ok(noWinnerLosesPrincipal(split, 10n * USDC));
  assert.ok(conservationHolds(split, 30n * USDC));
});

test("refunds and break-even wins are free", () => {
  for (const [gross, principal] of [[10n, 10n], [5n, 10n]] as const) {
    const split = splitFees({ gross, principal, policy, winner: WINNER, agentOwner: AGENT });
    assert.equal(split.totalFees, 0n);
    assert.equal(split.netPayout, gross);
  }
});

test("a winner never gets back less than the stake, even at the cap", () => {
  const capped: FeePolicy = { platformFeeBps: 900, agentOwnerFeeBps: 100, platformRecipient: PLATFORM };
  for (const [gross, principal] of [[11n, 10n], [2_000_001n, 2_000_000n], [10n ** 15n, 1n]] as const) {
    const split = splitFees({ gross, principal, policy: capped, winner: WINNER, agentOwner: AGENT });
    assert.ok(noWinnerLosesPrincipal(split, principal));
    assert.ok(conservationHolds(split, gross));
  }
});

test("self-paid legs and missing recipients are waived", () => {
  assert.equal(splitFees({ gross: 30n, principal: 10n, policy: { ...policy, platformFeeBps: 950 }, winner: PLATFORM }).platformFee, 0n);
  assert.equal(
    splitFees({ gross: 30_000n, principal: 10_000n, policy: { ...policy, agentOwnerFeeBps: 950 }, winner: WINNER, agentOwner: WINNER }).agentOwnerFee,
    0n
  );
  assert.equal(splitFees({ gross: 30_000n, principal: 10_000n, policy, winner: WINNER, agentOwner: NONE }).agentOwnerFee, 0n);
});

test("policy validation mirrors the program", () => {
  assert.doesNotThrow(() => validateFeePolicy({ platformFeeBps: 500, agentOwnerFeeBps: 500, platformRecipient: PLATFORM }));
  assert.throws(() => validateFeePolicy({ platformFeeBps: 900, agentOwnerFeeBps: 101, platformRecipient: PLATFORM }), InvalidFeePolicyError);
  assert.throws(() => validateFeePolicy({ platformFeeBps: 50, agentOwnerFeeBps: 0, platformRecipient: null }), InvalidFeePolicyError);
  assert.throws(() => validateFeePolicy({ platformFeeBps: -1, agentOwnerFeeBps: 0, platformRecipient: PLATFORM }), InvalidFeePolicyError);
  assert.doesNotThrow(() => validateFeePolicy({ platformFeeBps: 0, agentOwnerFeeBps: 50, platformRecipient: null }));
  assert.equal(MAX_TOTAL_FEE_BPS, 1000);
});

test("pool payout legs never exceed the pot", () => {
  const stakes = [3_000_000n, 7_000_000n, 2_500_000n];
  const total = stakes.reduce((a, b) => a + b, 0n);
  const creator = 11_000_000n;
  const paid = stakes.reduce((sum, s) => sum + challengerGross(2, s, creator, total)!.gross, 0n);
  assert.ok(paid <= total + creator);
  assert.ok(total + creator - paid < BigInt(stakes.length));
  assert.deepEqual(creatorGross(1, creator, total), { gross: creator + total, principal: creator });
  assert.equal(creatorGross(2, creator, total), null);
  assert.equal(challengerGross(1, 1n, 1n, 1n), null);
  assert.deepEqual(challengerGross(4, 5n, 9n, 9n), { gross: 5n, principal: 5n });
});
