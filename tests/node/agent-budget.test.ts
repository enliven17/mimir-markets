import test from "node:test";
import assert from "node:assert/strict";

import { STAKING_ACTIONS } from "../../lib/agents/registry";
import { parseWriteParams, stakeOf } from "../../lib/agents/params";
import { DISPUTE_BOND_UNITS } from "../../lib/solana/config";
import { releaseStake, reserveDailyStake } from "../../lib/agents/store";

test("a dispute bond counts against the agent's budget", () => {
  assert.ok(STAKING_ACTIONS.includes("dispute"));
  assert.equal(stakeOf(parseWriteParams("dispute", { claimId: 3 })), DISPUTE_BOND_UNITS);
});

/** A fake pg pool: records statements, the conditional INSERT returns `inserted` rows. */
function fakePool(inserted: Array<{ id: number }>) {
  const log: Array<{ sql: string; args: unknown[] }> = [];
  let released = 0;
  const client = {
    async query(sql: string, args: unknown[] = []) {
      log.push({ sql: sql.replace(/\s+/g, " ").trim(), args });
      return { rows: /INSERT INTO agent_request_audit/.test(sql) ? inserted : [], rowCount: 0 };
    },
    release() {
      released++;
    },
  };
  const pool = {
    connect: async () => client,
    query: (sql: string, args: unknown[]) => client.query(sql, args),
  };
  return { pool, log, released: () => released };
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

test("the daily budget check and record are one locked, conditional insert", async () => {
  const { pool, log, released } = fakePool([{ id: 42 }]);
  const id = await withPool(pool, () => reserveDailyStake("bot", "challenge", 5_000_000n, 20_000_000n, 1_000_000_000));
  assert.equal(id, 42);
  const sqls = log.map((l) => l.sql);
  assert.equal(sqls[0], "BEGIN");
  assert.match(sqls[1], /pg_advisory_xact_lock/);
  assert.match(sqls[2], /INSERT INTO agent_request_audit.*WHERE.*SUM\(amount_units\).*<=/);
  assert.equal(sqls[3], "COMMIT");
  assert.deepEqual(log[2].args, ["bot", "challenge", "5000000", 1_000_000_000, 1_000_000_000 - 86_400_000, "20000000"]);
  assert.equal(released(), 1);
});

test("over the cap nothing is recorded and null comes back", async () => {
  const { pool } = fakePool([]);
  const id = await withPool(pool, () => reserveDailyStake("bot", "challenge", 5_000_000n, 20_000_000n));
  assert.equal(id, null);
});

test("a failed prepare releases its reservation", async () => {
  const { pool, log } = fakePool([]);
  await withPool(pool, () => releaseStake(42, "prepare_failed"));
  assert.match(log[0].sql, /UPDATE agent_request_audit SET ok = FALSE/);
  assert.deepEqual(log[0].args, [42, "prepare_failed"]);
});
