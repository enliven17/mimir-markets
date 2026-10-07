import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseEther, zeroAddress } from "viem";

import {
  applyTicketCall,
  createMarketCall,
  maxGrossFor,
  MIMIR_FEES_ABI,
  MIMIR_POOL_ABI,
  MIMIR_V3_ABI,
  parseUsdc,
  poolQuote,
  stakeCall,
  vsChallengeQuote,
  vsCreatorQuote,
  vsRoom,
} from "../../lib/arc/markets";

const u = (n: string) => parseEther(n);

test("vs challenge: the entry fee comes off the stake, no fee on winnings", () => {
  // creator net 2, I send 2 at 0.5%: fee 0.01, net 1.99, profit 1.99*2/1.99 = 2 → 3.99
  assert.deepEqual(vsChallengeQuote(u("2"), 0n, u("2"), 50), { risk: u("2"), fee: u("0.01"), win: u("3.99"), atMost: true });
  // a 10M holder pays 0.1%: net 1.998, win 3.998
  assert.equal(vsChallengeQuote(u("2"), 0n, u("2"), 10).win, u("3.998"));
});

test("vs challenge: later challengers share the creator stake; copy trades give 2% of the profit", () => {
  // creator 2, 6 already in, net 2 at 0%: profit 2*2/8 = 0.5 → 2.5; as a copy: 0.5 - 1% - 1% = 0.49 → 2.49
  assert.equal(vsChallengeQuote(u("2"), u("6"), u("2"), 0).win, u("2.5"));
  assert.equal(vsChallengeQuote(u("2"), u("6"), u("2"), 0, true).win, u("2.49"));
});

test("vs room, max gross and creator ceiling follow the 5x cap on net stakes", () => {
  assert.equal(vsRoom(u("2"), u("3")), u("7"));
  assert.equal(vsRoom(u("2"), u("10")), 0n);
  assert.equal(maxGrossFor(u("9.95"), 50), u("10"));
  // send 10 at 0.5%: net 9.95, at most 6 × 9.95
  assert.equal(vsCreatorQuote(u("10"), 50).win, u("59.7"));
});

test("pool quote: entry fee off the stake, estimate not a ceiling", () => {
  // A has 2, B has 4, I send 2 on A at 0%: profit 2*4/4 = 2 → 4
  assert.deepEqual(poolQuote(u("2"), u("4"), u("2"), 0), { risk: u("2"), fee: 0n, win: u("4"), atMost: false });
  assert.equal(poolQuote(0n, 0n, u("2"), 50).win, u("1.99"));
});

test("parseUsdc accepts plain amounts only", () => {
  assert.equal(parseUsdc("2.5"), u("2.5"));
  assert.equal(parseUsdc("0"), null);
  assert.equal(parseUsdc("1e3"), null);
  assert.equal(parseUsdc("1.1234567"), null);
});

test("calls carry the gross stake as value, the referrer last", () => {
  const to = "0x95c540c083b03a0dafe15a6de4ea88e9be5be3be";
  const ref = "0x00000000000000000000000000000000000000ab";
  const c = createMarketCall(to, { kind: "vs", question: "q", labelA: "yes", labelB: "no", resolutionUrl: "https://x", category: "crypto", deadline: 100, stake: u("3") });
  assert.equal(c.value, u("3"));
  const d = decodeFunctionData({ abi: MIMIR_V3_ABI, data: c.data });
  assert.equal(d.functionName, "createClaim");
  assert.equal(d.args[5], u("3"));
  assert.equal(d.args[16], zeroAddress);
  const p = decodeFunctionData({ abi: MIMIR_POOL_ABI, data: stakeCall(to, "pool", 7, u("2"), 2, ref).data });
  assert.deepEqual([p.args[0], p.args[1], String(p.args[2]).toLowerCase()], [7n, 2, ref]);
});

test("a holder ticket becomes an applyTicket call; tier 0 needs none", () => {
  const fees = "0x561ef02886e8145ec0288d1240f3e45546b83c24";
  const sig = `0x${"11".repeat(65)}` as const;
  const call = applyTicketCall(fees, { account: fees, tier: 2, expires: 1_800_000_000, signature: sig });
  assert.ok(call);
  assert.deepEqual(decodeFunctionData({ abi: MIMIR_FEES_ABI, data: call.data }).args, [2, 1_800_000_000n, sig]);
  assert.equal(applyTicketCall(fees, { account: fees, tier: 0, expires: 1, signature: null }), null);
});
