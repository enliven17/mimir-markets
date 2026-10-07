import assert from "node:assert/strict";
import test, { before } from "node:test";
import { decodeFunctionData, parseEther } from "viem";

process.env.NEXT_PUBLIC_MIMIR_V3_ADDRESS = "0x0e3198328c2afdc242bf14265d5b4115d14236ea";
process.env.NEXT_PUBLIC_MIMIR_POOL_ADDRESS = "0x1558d46be99ca82ca4a857a7a918aae48b704055";
// The contract addresses are read when lib/arc/config loads, so it is imported after they are set.
let prepareArcWrite: typeof import("../../lib/agents/arc-chain").prepareArcWrite;
let arcOperatorOf: typeof import("../../lib/agents/arc-chain").arcOperatorOf;
let MIMIR_POOL_ABI: typeof import("../../lib/arc/markets").MIMIR_POOL_ABI;
let MIMIR_V3_ABI: typeof import("../../lib/arc/markets").MIMIR_V3_ABI;
before(async () => {
  ({ prepareArcWrite, arcOperatorOf } = await import("../../lib/agents/arc-chain"));
  ({ MIMIR_POOL_ABI, MIMIR_V3_ABI } = await import("../../lib/arc/markets"));
});

test("an agent's challenge is an unsigned Arc tx from its operator, stake in wei as value", () => {
  const { transactions } = prepareArcWrite({ action: "challenge", params: { claimId: 7n, stakeUnits: 2_500_000n } }, {});
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].to.toLowerCase(), "0x0e3198328c2afdc242bf14265d5b4115d14236ea");
  assert.equal(transactions[0].value, parseEther("2.5").toString());
  const d = decodeFunctionData({ abi: MIMIR_V3_ABI, data: transactions[0].data });
  assert.equal(d.functionName, "challengeClaim");
  assert.equal(d.args[0], 7n);
});

test("pool stakes take a side; dispute carries the 2 USDC bond; deposit is not a thing on Arc", () => {
  const pool = prepareArcWrite({ action: "challenge", params: { claimId: 3n, stakeUnits: 2_000_000n } }, { kind: "pool", side: 1 }).transactions[0];
  assert.deepEqual(decodeFunctionData({ abi: MIMIR_POOL_ABI, data: pool.data }).args.slice(0, 2), [3n, 1]);
  assert.equal(prepareArcWrite({ action: "dispute", params: { claimId: 3n } }, {}).transactions[0].value, parseEther("2").toString());
  assert.throws(() => prepareArcWrite({ action: "deposit", params: {} }, {}), /not needed on Arc/);
  assert.throws(() => prepareArcWrite({ action: "challenge", params: { claimId: 1n, stakeUnits: 2_000_000n } }, { kind: "pool", side: 3 }), /side/);
});

test("arc operators must be EVM addresses", () => {
  assert.equal(arcOperatorOf("0x0c6eea6557fe5c36e34ff8c4dfc0b6035b356fa7"), "0x0c6eea6557fe5c36E34ff8C4dfC0b6035b356FA7");
  assert.equal(arcOperatorOf("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"), null);
});
