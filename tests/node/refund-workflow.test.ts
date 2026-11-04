import test from "node:test";
import assert from "node:assert/strict";
import { oracleWork, recordZeroPoolPayout, deferPoolPayout } from "../../convex/arc";
import { memoryBackend } from "../helpers/convex-memory";
import { settlementTiming } from "../../lib/chains/settlement-timing";

const grace = 7 * 86_400;
const deadline = 1_800_000_000;
const proposedAt = deadline + grace - 100;
const refundAt = proposedAt + grace;
const row = (kind: "vs" | "pool", marketId: number, extra = {}) => ({
  chain: "arc", kind, marketId, creator: "creator", status: "proposed", deadline,
  updatedBlock: 10, createdAt: deadline - 1000, stakeA: "10", stakeB: "10", winner: 0,
  disputableUntil: proposedAt + 60, refundAt, ...extra,
});

test("index refund grace starts after the latest deadline, proposal or dispute", () => {
  assert.deepEqual(settlementTiming(BigInt(deadline), BigInt(proposedAt), 0n, 60n), {
    disputableUntil: proposedAt + 60, refundAt,
  });
  assert.equal(settlementTiming(100n, 200n, 300n, 60n).refundAt, 300 + grace);
  assert.equal(settlementTiming(300n, 100n, 200n, 60n).refundAt, 300 + grace);
  assert.deepEqual(settlementTiming(100n, 0n, 0n, 60n), { disputableUntil: 0, refundAt: 100 + grace });
});

test("worker offers paused proposals for refunds only after their full grace", async () => {
  const backend = memoryBackend();
  await backend.db.insert("arcMarkets", row("vs", 1));
  await backend.db.insert("arcMarkets", row("pool", 2));
  await backend.db.insert("arcMarkets", row("vs", 3, { chain: "base" }));
  const work = (now: number, vsPaused: boolean, poolPaused: boolean) =>
    backend.run(oracleWork, { chain: "arc", now, vsPaused, poolPaused });
  assert.deepEqual((await work(refundAt - 1, true, true)).refund, []);
  assert.deepEqual((await work(refundAt, false, false)).refund, []);
  const paused = await work(refundAt, true, false);
  assert.deepEqual(paused.refund, [{ chain: "arc", kind: "vs", marketId: 1 }]);
  assert.deepEqual(paused.finalize, [{ chain: "arc", kind: "pool", marketId: 2 }]);
  assert.deepEqual((await work(refundAt, true, true)).refund.map((m: any) => m.marketId), [1, 2]);
});

test("paused pools still offer refunds for payment, but hold contested winners", async () => {
  const backend = memoryBackend();
  await backend.db.insert("arcMarkets", row("pool", 1, { status: "resolved", winner: 4 }));
  await backend.db.insert("arcMarkets", row("pool", 2, { status: "resolved", winner: 1 }));
  await backend.db.insert("arcMarkets", row("pool", 3, { status: "resolved", winner: 1, stakeB: "0" }));
  for (const marketId of [1, 2, 3]) await backend.db.insert("arcPositions", { chain: "arc", kind: "pool", marketId, user: "alice", side: 1, claimed: false });
  const work = await backend.run(oracleWork, { chain: "arc", now: refundAt, vsPaused: true, poolPaused: true });
  assert.deepEqual(work.pay.map((p: any) => p.marketId).sort(), [1, 3]);
  const unpaused = await backend.run(oracleWork, { chain: "arc", now: refundAt });
  assert.deepEqual(unpaused.pay.map((p: any) => p.marketId).sort(), [1, 2, 3]);
});


test("late losing deposits are offered for autopay, including during pause; claimed users stay excluded", async () => {
  const backend = memoryBackend();
  await backend.db.insert("arcMarkets", row("pool", 4, { status: "resolved", winner: 1, settlementCutoff: deadline - 100 }));
  for (const [user, side, claimed] of [["winner", 1, false], ["loser-with-late-deposit", 2, false], ["already-paid", 2, true]]) {
    await backend.db.insert("arcPositions", { chain: "arc", kind: "pool", marketId: 4, user, side, claimed });
  }
  for (const poolPaused of [false, true]) {
    const work = await backend.run(oracleWork, { chain: "arc", now: refundAt, poolPaused });
    assert.deepEqual(work.pay, [{ marketId: 4, users: ["winner", "loser-with-late-deposit"] }]);
    // On-chain claimable/simulation excludes zero payouts and holds mixed winning payouts while paused.
  }
});


test("zero-owed users cannot starve older winners and a newer snapshot invalidates a zero acknowledgement", async () => {
  const backend = memoryBackend();
  for (let id = 1; id <= 51; id++) {
    await backend.db.insert("arcMarkets", row("pool", id, { status: "resolved", winner: 1, settlementCutoff: deadline - 100, deadline: deadline + id }));
    await backend.db.insert("arcPositions", { chain: "arc", kind: "pool", marketId: id, user: id === 1 ? "unpaid-winner" : "early-loser", side: id === 1 ? 1 : 2 });
  }
  const run = () => backend.run(oracleWork, { chain: "arc", now: refundAt });
  assert.equal((await run()).pay.some((p: any) => p.marketId === 1), false);
  for (let id = 2; id <= 51; id++) await backend.run(recordZeroPoolPayout, { chain: "arc", marketId: id, user: "early-loser", block: 11, outcome: 1, cutoff: deadline - 100 });
  assert.deepEqual((await run()).pay, [{ marketId: 1, users: ["unpaid-winner"] }]);
  const m = (await backend.db.query("arcMarkets").collect()).find((m: any) => m.marketId === 51);
  await backend.db.patch(m._id, { updatedBlock: 12 });
  assert.equal((await run()).pay.some((p: any) => p.marketId === 51), true);
});

test("zero acknowledgement rejects stale or mismatched settlement snapshots", async () => {
  const backend = memoryBackend();
  await backend.db.insert("arcMarkets", row("pool", 1, { status: "resolved", winner: 1, settlementCutoff: 80 }));
  const id = await backend.db.insert("arcPositions", { chain: "arc", kind: "pool", marketId: 1, user: "alice", side: 2 });
  const a = { chain: "arc", marketId: 1, user: "alice", block: 11, outcome: 1, cutoff: 80 };
  for (const extra of [{ block: 9 }, { outcome: 2 }, { cutoff: 81 }]) {
    await backend.run(recordZeroPoolPayout, { ...a, ...extra });
    assert.equal((await backend.db.get(id)).zeroPayoutBlock, undefined);
  }
});

test("failed or paused positive payouts back off without blocking other markets", async () => {
  const backend = memoryBackend();const now = Math.floor(Date.now() / 1000);
  for (const marketId of [1, 2]) {
    await backend.db.insert("arcMarkets", row("pool", marketId, { status: "resolved", winner: 1, settlementCutoff: 80, deadline: now - 10 }));
    await backend.db.insert("arcPositions", { chain: "arc", kind: "pool", marketId, user: `user${marketId}`, side: 1 });
  }
  await backend.run(deferPoolPayout, { chain: "arc", marketId: 2, user: "user2" });
  const run = (at: number) => backend.run(oracleWork, { chain: "arc", now: at, poolPaused: true });
  assert.deepEqual((await run(now)).pay, [{ marketId: 1, users: ["user1"] }]);
  assert.equal((await run(now + 601)).pay.length, 2);
});
