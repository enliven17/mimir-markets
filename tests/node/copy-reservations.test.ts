import test from "node:test";
import assert from "node:assert/strict";

import { COPY_RESERVATION_TTL_MS, loadUsage, releaseCopy, reserveCopy } from "../../lib/copy-trading-store";

function fakePool(rowsFor: (sql: string) => Array<Record<string, unknown>>) {
  const log: Array<{ sql: string; args: unknown[] }> = [];
  const pool = {
    async query(sql: string, args: unknown[] = []) {
      const flat = sql.replace(/\s+/g, " ").trim();
      log.push({ sql: flat, args });
      return { rows: rowsFor(flat) };
    },
  };
  return { pool, log };
}

async function withPool<T>(pool: unknown, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const prev = { url: process.env.DATABASE_URL, pool: g.__mimirSolanaPool, ready: g.__mimirSolanaDbReady };
  process.env.DATABASE_URL = "postgres://fake";
  g.__mimirSolanaPool = pool;
  g.__mimirSolanaDbReady = Promise.resolve(pool);
  try {
    return await fn();
  } finally {
    if (prev.url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev.url;
    g.__mimirSolanaPool = prev.pool;
    g.__mimirSolanaDbReady = prev.ready;
  }
}

function txPool(liveRows: number, inserted: boolean) {
  const log: Array<{ sql: string; args: unknown[] }> = [];
  const client = {
    async query(sql: string, args: unknown[] = []) {
      const flat = sql.replace(/\s+/g, " ").trim();
      log.push({ sql: flat, args });
      if (flat.startsWith("SELECT 1 FROM copy_reservations")) return { rows: Array(liveRows).fill({ "?column?": 1 }) };
      if (flat.startsWith("INSERT")) return { rows: inserted ? [{ permission_id: "p1" }] : [] };
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client, query: client.query }, log };
}
const caps = { maxDailyUsdc: 10, maxWeeklyUsdc: 30 };

test("prepare reserves under a per-permission lock, checking daily and weekly caps in the insert", async () => {
  const { pool, log } = txPool(0, true);
  assert.equal(await withPool(pool, () => reserveCopy("p1", 9, 3, caps, 1_000)), "ok");
  const sqls = log.map((l) => l.sql);
  assert.deepEqual(sqls[0], "BEGIN");
  assert.match(sqls[1], /pg_advisory_xact_lock/);
  const insert = log.find((l) => l.sql.startsWith("INSERT"))!;
  assert.match(insert.sql, /copy_executions/);
  assert.ok(insert.sql.includes("+ $3 <= $7"), "daily cap");
  assert.ok(insert.sql.includes("+ $3 <= $9"), "weekly cap");
  assert.deepEqual(insert.args.slice(0, 5), ["p1", 9, 3, 1_000, 1_000 + COPY_RESERVATION_TTL_MS]);
  assert.deepEqual(insert.args.slice(6), [10, 1_000 - 7 * 86_400_000, 30]);
  assert.equal(sqls.at(-1), "COMMIT");
});

test("a live reservation for the same claim refuses a second prepare; a full cap refuses any", async () => {
  assert.equal(await withPool(txPool(1, true).pool, () => reserveCopy("p1", 9, 3, caps, 1_000)), "duplicate");
  assert.equal(await withPool(txPool(0, false).pool, () => reserveCopy("p1", 9, 3, caps, 1_000)), "over_cap");
});

test("an unreported reservation keeps counting for the whole weekly window", () => {
  assert.equal(COPY_RESERVATION_TTL_MS, 7 * 86_400_000);
});

test("usage counts unexpired, unreported reservations toward the follower's limits", async () => {
  const now = 10 * 86_400_000;
  const { pool, log } = fakePool(() => [
    { claim_id: 1, stake_usdc: 2, at: now - 1_000, state: 1, winner_side: 0 },
    { claim_id: 2, stake_usdc: 3, at: now - 500, state: null, winner_side: 0 },
  ]);
  const usage = await withPool(pool, () => loadUsage("p1", now));
  assert.match(log[0].sql, /copy_reservations/);
  assert.match(log[0].sql, /expires_at > \$3/);
  assert.match(log[0].sql, /NOT EXISTS/);
  assert.equal(log[0].args[2], now);
  assert.equal(usage.spentTodayUsdc, 5);
  assert.equal(usage.openExposureUsdc, 5);
  assert.deepEqual(usage.heldClaimIds, [1, 2]);
});

test("a report releases the reservation", async () => {
  const { pool, log } = fakePool(() => []);
  await withPool(pool, () => releaseCopy("p1", 9));
  assert.match(log[0].sql, /DELETE FROM copy_reservations WHERE permission_id = \$1 AND claim_id = \$2/);
});
