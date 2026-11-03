import test from "node:test";
import assert from "node:assert/strict";
import { oracleWork } from "../../convex/arc";
import { memoryBackend } from "../helpers/convex-memory";
import { settlementTiming } from "../../lib/chains/settlement-timing";

const grace = 7 * 86_400;
const deadline = 1_800_000_000;
const proposedAt = deadline + grace - 100;
const refundAt = proposedAt + grace;
const row = (kind: "vs" | "pool", marketId: number, extra = {}) => ({
  chain: "arc", kind, marketId, creator: "creator", status: "proposed", deadline,
  createdAt: deadline - 1000, stakeA: "10", stakeB: "10", winner: 0,
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
