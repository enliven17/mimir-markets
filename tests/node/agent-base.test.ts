import assert from "node:assert/strict";
import test, { before } from "node:test";
import { decodeFunctionData } from "viem";

// Both chains configured: Base is the default. Read when lib/chains/registry loads, so it is imported after.
process.env.NEXT_PUBLIC_MIMIR_V3_ADDRESS = "0x0e3198328c2afdc242bf14265d5b4115d14236ea";
process.env.NEXT_PUBLIC_MIMIR_POOL_ADDRESS = "0x1558d46be99ca82ca4a857a7a918aae48b704055";
process.env.NEXT_PUBLIC_MIMIR_BASE_V3_ADDRESS = "0x00000000000000000000000000000000000000b3";
process.env.NEXT_PUBLIC_MIMIR_BASE_POOL_ADDRESS = "0x00000000000000000000000000000000000000b4";
let prepareArcWrite: typeof import("../../lib/agents/arc-chain").prepareArcWrite;
let ERC20_POOL_ABI: typeof import("../../lib/chains/calls").ERC20_POOL_ABI;
let ERC20_ABI: typeof import("../../lib/chains/client").ERC20_ABI;
before(async () => {
  ({ prepareArcWrite } = await import("../../lib/agents/arc-chain"));
  ({ ERC20_POOL_ABI } = await import("../../lib/chains/calls"));
  ({ ERC20_ABI } = await import("../../lib/chains/client"));
});

test("agent API on Base (the default): approve then stake, value 0, 6-dp amounts, Base Sepolia chain id", () => {
  const r = prepareArcWrite({ action: "challenge", params: { claimId: 3n, stakeUnits: 2_000_000n } }, { kind: "pool", side: 1 });
  assert.equal(r.chain, "base");
  assert.equal(r.transactions.length, 2);
  const [approve, stake] = r.transactions;
  assert.equal(approve.chainId, 84532);
  assert.equal(approve.to.toLowerCase(), "0x036cbd53842c5426634e7929541ec2318f3dcf7e");
  assert.deepEqual(decodeFunctionData({ abi: ERC20_ABI, data: approve.data }).args, ["0x00000000000000000000000000000000000000B4", 2_000_000n]);
  assert.equal(stake.value, "0");
  assert.deepEqual(decodeFunctionData({ abi: ERC20_POOL_ABI, data: stake.data }).args, [3n, 1, "0x0000000000000000000000000000000000000000", 2_000_000n]);
  // The allowance covers it: no approve.
  assert.equal(prepareArcWrite({ action: "challenge", params: { claimId: 3n, stakeUnits: 2_000_000n } }, { kind: "pool", side: 1 }, 2_000_000_000_000_000_000n).transactions.length, 1);
  // Arc on request: one payable call.
  const arc = prepareArcWrite({ action: "challenge", params: { claimId: 3n, stakeUnits: 2_000_000n } }, { kind: "pool", side: 1, chain: "arc" });
  assert.equal(arc.chain, "arc");
  assert.equal(arc.transactions.length, 1);
  assert.equal(arc.transactions[0].value, "2000000000000000000");
});
