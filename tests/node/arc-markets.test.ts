import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseEther } from "viem";

import { createMarketCall, MIMIR_V3_ABI, parseUsdc, poolQuote, stakeCall, vsChallengeQuote, vsCreatorQuote, vsRoom } from "../../lib/arc/markets";

const u = (n: string) => parseEther(n);

test("vs challenge: first challenger takes the whole creator stake, fee on profit only", () => {
  // creator 2, I stake 2 with no one else: profit 2, 5% fee 0.1 → 3.9 (the POC payout)
  assert.deepEqual(vsChallengeQuote(u("2"), 0n, u("2"), 500), { risk: u("2"), win: u("3.9"), atMost: true });
});

test("vs challenge: later challengers share the creator stake pro rata", () => {
  // creator 2, 6 already in, I add 2: my share 2*2/8 = 0.5, no fee
  assert.equal(vsChallengeQuote(u("2"), u("6"), u("2"), 0).win, u("2.5"));
});

test("vs room and creator ceiling follow the 5x cap", () => {
  assert.equal(vsRoom(u("2"), u("3")), u("7"));
  assert.equal(vsRoom(u("2"), u("10")), 0n);
  assert.equal(vsCreatorQuote(u("2"), 0).win, u("12"));
});

test("pool quote counts my side's existing stake", () => {
  // A has 2, B has 4, I add 2 on A: profit 2*4/4 = 2 → 4, 5% fee 0.1 → 3.9
  assert.deepEqual(poolQuote(u("2"), u("4"), u("2"), 500), { risk: u("2"), win: u("3.9"), atMost: false });
  assert.equal(poolQuote(0n, 0n, u("2"), 500).win, u("2"));
});

test("parseUsdc accepts plain amounts only", () => {
  assert.equal(parseUsdc("2.5"), u("2.5"));
  assert.equal(parseUsdc("0"), null);
  assert.equal(parseUsdc("1e3"), null);
  assert.equal(parseUsdc("1.1234567"), null);
});

test("calls carry the stake as value and the right arguments", () => {
  const to = "0x95c540c083b03a0dafe15a6de4ea88e9be5be3be";
  const c = createMarketCall(to, { kind: "vs", question: "q", labelA: "yes", labelB: "no", resolutionUrl: "https://x", category: "crypto", deadline: 100, stake: u("3") });
  assert.equal(c.value, u("3"));
  const d = decodeFunctionData({ abi: MIMIR_V3_ABI, data: c.data });
  assert.equal(d.functionName, "createClaim");
  assert.equal(d.args[5], u("3"));
  assert.equal(d.args[9], "pool");
  const s = stakeCall(to, "vs", 7, u("2"), 2);
  assert.equal(decodeFunctionData({ abi: MIMIR_V3_ABI, data: s.data }).args[0], 7n);
});
