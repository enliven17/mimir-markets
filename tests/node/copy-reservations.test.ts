import test from "node:test";
import assert from "node:assert/strict";

import { COPY_RESERVATION_TTL_MS, loadUsage, recordExecution, releaseCopy, reserveCopy } from "../../lib/copy-trading-store";
import { useMemoryStore } from "../../lib/server/store";

const caps = { maxDailyUsdc: 10, maxWeeklyUsdc: 30 };

async function withStore<T>(fn: () => Promise<T>): Promise<T> {
  useMemoryStore();
  try {
    return await fn();
  } finally {
    useMemoryStore(null);
  }
}

test("prepare reserves under the permission's compare-and-set, checking daily and weekly caps", () =>
  withStore(async () => {
    assert.equal(await reserveCopy("p1", 9, 3, caps, 1_000), "ok");
    // Concurrent prepares for different claims cannot both fit the same room: 3 + 4 + 4 > 10.
    const [a, b] = await Promise.all([reserveCopy("p1", 10, 4, caps, 1_000), reserveCopy("p1", 11, 4, caps, 1_000)]);
    assert.deepEqual([a, b].sort(), ["ok", "over_cap"]);
  }));

test("a live reservation for the same claim refuses a second prepare; a full cap refuses any", () =>
  withStore(async () => {
    assert.equal(await reserveCopy("p1", 9, 3, caps, 1_000), "ok");
    assert.equal(await reserveCopy("p1", 9, 3, caps, 1_000), "duplicate");
    assert.equal(await reserveCopy("p1", 12, 8, caps, 1_000), "over_cap");
  }));

test("an unreported reservation keeps counting for the whole weekly window", () => {
  assert.equal(COPY_RESERVATION_TTL_MS, 7 * 86_400_000);
});

test("usage counts unexpired, unreported reservations toward the follower's limits", () =>
  withStore(async () => {
    const now = 10 * 86_400_000;
    await recordExecution({ permissionId: "p1", claimId: 1, executed: true, stakeUsdc: 2 }, now - 1_000);
    assert.equal(await reserveCopy("p1", 2, 3, caps, now - 500), "ok");
    // A reservation whose copy was reported executed counts once, not twice.
    assert.equal(await reserveCopy("p1", 1, 2, caps, now - 400), "ok");
    const usage = await loadUsage("p1", now, async () => new Map([[1, { state: 1, winnerSide: 0 }]]));
    assert.equal(usage.spentTodayUsdc, 5);
    assert.equal(usage.openExposureUsdc, 5);
    assert.deepEqual(usage.heldClaimIds.sort(), [1, 2]);
    // An expired reservation stops counting.
    const later = await loadUsage("p1", now - 500 + COPY_RESERVATION_TTL_MS + 1);
    assert.equal(later.heldClaimIds.length, 1);
  }));

test("a report releases the reservation", () =>
  withStore(async () => {
    assert.equal(await reserveCopy("p1", 9, 3, caps, 1_000), "ok");
    await releaseCopy("p1", 9);
    assert.equal((await loadUsage("p1", 2_000)).heldClaimIds.length, 0);
  }));

test("an executed copy is recorded once per claim", () =>
  withStore(async () => {
    assert.equal(await recordExecution({ permissionId: "p1", claimId: 4, executed: true, stakeUsdc: 1 }), true);
    assert.equal(await recordExecution({ permissionId: "p1", claimId: 4, executed: true, stakeUsdc: 1 }), false);
    assert.equal(await recordExecution({ permissionId: "p1", claimId: 4, executed: false, skipReason: "globally_paused" }), true);
  }));
