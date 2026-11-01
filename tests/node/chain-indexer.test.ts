import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseEventLogs, type Hex, type Log } from "viem";

import { eventRow, POOL_ABI, V3_ABI, type DecodedLog } from "../../lib/chains/indexer";
import { siblingDecision, reuseDecision, pairKeyOf, type LinkedVerdict } from "../../lib/chains/linked";

const USER = "0x00000000000000000000000000000000000000AA";
const BASE = { id: "base" as const, usdc: { decimals: 6 as const } };
const ARC = { id: "arc" as const, usdc: { decimals: 18 as const } };

/** A raw log as an RPC returns it, decoded the way convex/arcSync.ts decodes it. */
function decode(abi: typeof POOL_ABI | typeof V3_ABI, eventName: string, args: Record<string, unknown>, data: Hex): DecodedLog {
  const topics = encodeEventTopics({ abi, eventName, args } as Parameters<typeof encodeEventTopics>[0]);
  const raw = {
    address: "0x0000000000000000000000000000000000000004",
    topics,
    data,
    blockNumber: 10n,
    blockHash: `0x${"0".repeat(64)}`,
    transactionHash: `0x${"ab".repeat(32)}`,
    transactionIndex: 0,
    logIndex: 3,
    removed: false,
  } as unknown as Log;
  return parseEventLogs({ abi, logs: [raw], strict: false })[0] as unknown as DecodedLog;
}

test("indexer: a Base Staked log (6 dp) becomes an 18-dp row tagged base", () => {
  const log = decode(POOL_ABI, "Staked", { id: 7n, user: USER }, encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }], [2, 1_500_000n]));
  const row = eventRow(BASE, "pool", log);
  assert.equal(row.chain, "base");
  assert.equal(row.marketId, 7);
  assert.equal(row.name, "Staked");
  assert.equal(row.user, USER.toLowerCase());
  assert.equal(row.side, 2);
  assert.equal(row.amount, "1500000000000000000");
});

test("indexer: the same log on Arc is already 18 dp; a Base bond and a fee scale too; a veto has no user", () => {
  const log = decode(POOL_ABI, "Staked", { id: 7n, user: USER }, encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }], [1, 1_500_000_000_000_000_000n]));
  assert.equal(eventRow(ARC, "pool", log).amount, "1500000000000000000");
  const bond = decode(V3_ABI, "ResolutionDisputed", { id: 2n, disputer: USER }, encodeAbiParameters([{ type: "uint256" }], [2_000_000n]));
  assert.equal(eventRow(BASE, "vs", bond).amount, "2000000000000000000");
  const fee = decode(POOL_ABI, "FeeAccrued", { id: 2n, recipient: USER }, encodeAbiParameters([{ type: "uint256" }], [7_500n]));
  assert.equal(eventRow(BASE, "pool", fee).amount, "7500000000000000");
  const veto = decode(V3_ABI, "ResolutionDisputed", { id: 2n, disputer: "0x0000000000000000000000000000000000000000" }, encodeAbiParameters([{ type: "uint256" }], [0n]));
  const v = eventRow(BASE, "vs", veto);
  assert.equal(v.name, "ResolutionVetoed");
  assert.equal(v.user, undefined);
});

const decision = (chain: "arc" | "base", over: Partial<LinkedVerdict> = {}): LinkedVerdict => ({
  chain, side: 1, decided: 1, confidence: 90, summary: "A won.", evidenceHash: `0x${"1".repeat(64)}`, bundle: JSON.stringify({ v: 1 }), ...over,
});

test("linked: the second chain reuses the first chain's decision; a refund that decided nothing is skipped", () => {
  assert.equal(siblingDecision([], "base"), null);
  assert.equal(siblingDecision([decision("base")], "base"), null, "its own verdict is not a sibling's");
  // An uncontested pool's DRAW refund decided nothing: decide afresh.
  assert.equal(siblingDecision([decision("arc", { side: 3, decided: undefined })], "base"), null);
  const got = siblingDecision([decision("arc", { side: 3, decided: undefined }), decision("arc", { side: 2, decided: 2 })], "base");
  assert.equal(got?.decided, 2);
  const r = reuseDecision(got!);
  assert.equal(r.side, 2);
  assert.equal(r.evidenceHash, `0x${"1".repeat(64)}`);
});

test("linked: a sibling's late-stake refund is its own; the decision underneath is what the other chain proposes", () => {
  const overridden = decision("arc", {
    side: 4,
    decided: 1,
    summary: "Stakes after the result: refunded.",
    decidedSummary: "A won.",
    bundle: JSON.stringify({ v: 1, lateStakeRefund: { knownAt: 5 } }),
    evidenceHash: `0x${"9".repeat(64)}`,
  });
  const r = reuseDecision(siblingDecision([overridden], "base")!);
  assert.equal(r.side, 1);
  assert.equal(r.summary, "A won.");
  assert.equal(r.evidenceHash, null, "the stripped bundle is re-sealed by the oracle");
  assert.deepEqual(JSON.parse(r.bundle), { v: 1 });
});

test("linked: the pair key is stable for one draft and differs per opener and per draft", () => {
  const d = { question: "Will BTC close above $120k?", deadline: 2_000_000_000, resolutionUrl: "https://x" };
  assert.equal(pairKeyOf("house", d), pairKeyOf("house", { ...d, question: "  will btc close above $120k? " }));
  assert.notEqual(pairKeyOf("house", d), pairKeyOf("agent:odin", d));
  assert.notEqual(pairKeyOf("house", d), pairKeyOf("house", { ...d, deadline: d.deadline + 1 }));
  assert.match(pairKeyOf("house", d), /^house:[0-9a-f]{24}$/);
});
