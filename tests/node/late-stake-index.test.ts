import assert from "node:assert/strict";
import test from "node:test";
import { stakeTimes } from "../../convex/arc";
import { lateStakes } from "../../lib/late-stakes";
import { memoryBackend } from "../helpers/convex-memory";

test("late-stake detection includes stakes beyond 2,000 mixed market events", async () => {
  const mem = memoryBackend();
  const row = { chain: "base", kind: "pool", marketId: 7 };
  for (let i = 0; i < 2100; i++) {
    await mem.db.insert("arcEvents", { ...row, name: i % 2 ? "FeeAccrued" : "Staked", at: 100 });
  }
  await mem.db.insert("arcEvents", { ...row, name: "Staked", at: 300, user: "late" });
  const times = await mem.run(stakeTimes, row);
  assert.deepEqual(lateStakes(200, times), [{ at: 300, user: "late" }]);
  assert.ok(times.length <= 4, "existence check must stay bounded as history grows");
});

test("latest stake timestamps cover every stake event type and remain market-isolated", async () => {
  const mem = memoryBackend();
  const row = { chain: "arc", kind: "vs", marketId: 1 };
  const names = ["ClaimCreated", "ClaimChallenged", "MarketCreated", "Staked"];
  for (const name of names) {
    await mem.db.insert("arcEvents", { ...row, name, at: 300, user: name });
    await mem.db.insert("arcEvents", { ...row, name, at: 100 }); // imported later, earlier block time
  }
  for (const foreign of [{ chain: "base" }, { kind: "pool" }, { marketId: 2 }]) {
    await mem.db.insert("arcEvents", { ...row, ...foreign, name: "Staked", at: 900 });
  }
  await mem.db.insert("arcEvents", { ...row, name: "FeeAccrued", at: 900 });
  assert.deepEqual(await mem.run(stakeTimes, row), names.map(name => ({ at: 300, user: name })));
  assert.deepEqual(await mem.run(stakeTimes, { ...row, marketId: 99 }), []);
});

test("missing legacy stake timestamps defer settlement rather than prove history safe", async () => {
  for (const name of ["ClaimCreated", "ClaimChallenged", "MarketCreated", "Staked"]) {
    const mem = memoryBackend();
    const row = { chain: "base", kind: "pool", marketId: 7 };
    await mem.db.insert("arcEvents", { ...row, name, at: 100 });
    await mem.db.insert("arcEvents", { ...row, name, block: 300 });
    await assert.rejects(mem.run(stakeTimes, row), /missing block timestamps/);
  }
});
