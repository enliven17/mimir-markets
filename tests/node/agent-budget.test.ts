import test from "node:test";
import assert from "node:assert/strict";

import { STAKING_ACTIONS } from "../../lib/agents/registry";
import { parseWriteParams, stakeOf } from "../../lib/agents/params";
import { DISPUTE_BOND_UNITS } from "../../lib/solana/config";
import { releaseStake, requestsLastHour, reserveDailyStake, stakedLastDayUnits } from "../../lib/agents/store";
import { useMemoryStore } from "../../lib/server/store";

test("a dispute bond counts against the agent's budget", () => {
  assert.ok(STAKING_ACTIONS.includes("dispute"));
  assert.equal(stakeOf(parseWriteParams("dispute", { claimId: 3 })), DISPUTE_BOND_UNITS);
});

test("the daily budget check and record are one compare-and-set: concurrent reservations never overspend", async () => {
  useMemoryStore();
  try {
    const now = 1_000_000_000;
    // Four concurrent 6 USDC reservations against a 20 USDC day: exactly three fit.
    const ids = await Promise.all(Array.from({ length: 4 }, () => reserveDailyStake("bot", "challenge", 6_000_000n, 20_000_000n, now)));
    assert.equal(ids.filter((id) => id !== null).length, 3);
    assert.equal(await stakedLastDayUnits("bot", now), 18_000_000n);
    // A day later the window is empty again.
    assert.equal(await stakedLastDayUnits("bot", now + 86_400_001), 0n);
  } finally {
    useMemoryStore(null);
  }
});

test("over the cap nothing is recorded and null comes back", async () => {
  useMemoryStore();
  try {
    assert.equal(await reserveDailyStake("bot", "challenge", 25_000_000n, 20_000_000n), null);
    assert.equal(await stakedLastDayUnits("bot"), 0n);
  } finally {
    useMemoryStore(null);
  }
});

test("a failed prepare releases its reservation", async () => {
  useMemoryStore();
  try {
    const now = Date.now();
    const id = await reserveDailyStake("bot", "challenge", 5_000_000n, 20_000_000n, now);
    assert.ok(id);
    await releaseStake(id, "prepare_failed");
    assert.equal(await stakedLastDayUnits("bot", now), 0n);
    assert.equal(await requestsLastHour("bot", now), 0, "the released call no longer counts as allowed");
  } finally {
    useMemoryStore(null);
  }
});
