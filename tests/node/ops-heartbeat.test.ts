import assert from "node:assert/strict";
import test from "node:test";

import { reportingPoll } from "../../lib/ops/heartbeat";

delete process.env.DATABASE_URL;

test("reportingPoll never runs two cycles at once", async () => {
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const tick = reportingPoll("oracle", 1000, async () => {
    active++;
    runs++;
    maxActive = Math.max(maxActive, active);
    await gate;
    active--;
  });

  const first = tick();
  await tick(); // fires while the first is still running: skipped
  release();
  await first;
  await tick();
  assert.equal(maxActive, 1);
  assert.equal(runs, 2);
});

test("reportingPoll swallows a failed cycle and runs the next one", async () => {
  let runs = 0;
  const tick = reportingPoll("indexer", 1000, async () => {
    runs++;
    if (runs === 1) throw new Error("rpc down");
  });
  await tick();
  await tick();
  assert.equal(runs, 2);
});

test("a paused worker skips its cycle", async () => {
  process.env.MIMIR_PAUSE_COUNCIL_WORKER = "1";
  try {
    let runs = 0;
    const tick = reportingPoll("council", 1000, async () => {
      runs++;
    });
    await tick();
    assert.equal(runs, 0);
  } finally {
    delete process.env.MIMIR_PAUSE_COUNCIL_WORKER;
  }
});
