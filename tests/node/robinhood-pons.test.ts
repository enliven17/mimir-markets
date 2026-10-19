import assert from "node:assert/strict";
import test from "node:test";

import { decodeAbiParameters, parseAbiParameters, parseEther } from "viem";

import { gweiToWei, minOut, quoteCurveBuy, quoteCurveSell, weiToGwei } from "../../lib/launch/robinhood/pons";
import { robinhoodAgentPolicy } from "../../lib/launch/robinhood/policy";
import { ponsPool, v4SwapCall } from "../../lib/launch/robinhood/v4";

// A live curve's reserves (Robinhood Chain, 2026-10-19): the on-chain buy of 0.001 ETH returned exactly this.
const LIVE = { quote: 1_701_049_525_200_679_698n, tokens: 987_625_565_929_248_062_378_596_658n, feeBps: 100n, taxBps: 0n };

test("curve quotes follow the contract: fee off the ETH leg, x·y=k", () => {
  const out = quoteCurveBuy(parseEther("0.001"), LIVE);
  assert.ok(out > 0n);
  // Selling back what was bought returns less than was paid (fee both ways).
  const back = quoteCurveSell(out, { ...LIVE, quote: LIVE.quote + parseEther("0.00099"), tokens: LIVE.tokens - out });
  assert.ok(back < parseEther("0.001") && back > parseEther("0.00097"));
  assert.equal(quoteCurveBuy(0n, LIVE), 0n);
});

test("gwei is the engine's unit: round trip and truncation", () => {
  assert.equal(weiToGwei(parseEther("1")), 1_000_000_000n);
  assert.equal(gweiToWei(weiToGwei(parseEther("0.0123"))), parseEther("0.0123"));
  assert.equal(weiToGwei(999_999_999n), 0n);
});

test("minOut takes slippage off and clamps silly values", () => {
  assert.equal(minOut(10_000n, 300), 9_700n);
  assert.equal(minOut(10_000n, -5), 10_000n);
  assert.equal(minOut(10_000n, 20_000), 0n);
});

test("a v4 swap is one V4_SWAP command: swap, settle the input, take the output", () => {
  const token = "0x295A701e7038A7A7b9b23d700E096416B074f526";
  const pool = ponsPool(token, 0, 200);
  const [commands, inputs, deadline] = v4SwapCall(pool, false, 5n, 3n, 99n);
  assert.equal(commands, "0x10");
  assert.equal(deadline, 99n);
  const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes, bytes[]"), inputs[0]);
  assert.equal(actions, "0x060c0f");
  // Selling the token: settle the token, take ETH (address 0).
  assert.deepEqual(decodeAbiParameters(parseAbiParameters("address, uint256"), params[1]), [token, 5n]);
  assert.deepEqual(decodeAbiParameters(parseAbiParameters("address, uint256"), params[2]), ["0x0000000000000000000000000000000000000000", 3n]);
});

test("the wallet policy pins the chain, pays only the owner and the treasury, and buys or sells only to itself", () => {
  const p = robinhoodAgentPolicy("0xAAAA000000000000000000000000000000000001", "0xBBBB000000000000000000000000000000000002", null);
  assert.equal(p.chain_type, "ethereum");
  for (const r of p.rules) assert.deepEqual(r.conditions[0], { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "4663" });
  const pay = p.rules.find((r) => r.name.startsWith("Pay"))!;
  assert.deepEqual(pay.conditions[1].value, ["0xbbbb000000000000000000000000000000000002"]);
  const buy = p.rules.find((r) => r.name.startsWith("Curve buy"))!;
  assert.equal(buy.conditions[1].value, "0xaaaa000000000000000000000000000000000001");
});
