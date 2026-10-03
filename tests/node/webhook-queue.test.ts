import test from "node:test";
import assert from "node:assert/strict";

import { createDeliveryQueue } from "../../lib/server/webhook-queue";

const tick = () => new Promise((r) => setImmediate(r));

test("enqueue never blocks the caller and at most `concurrency` jobs run at once", async () => {
  const q = createDeliveryQueue({ concurrency: 4 });
  let running = 0;
  let peak = 0;
  const gates: Array<() => void> = [];
  for (let i = 0; i < 10; i++) {
    const accepted = q.enqueue(`https://hook${i}.example/`, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((r) => gates.push(r));
      running--;
    });
    assert.equal(accepted, true);
  }
  await tick();
  assert.equal(running, 4, "only four in flight");
  while (gates.length) {
    gates.shift()!();
    await tick();
    await tick();
  }
  await q.idle();
  assert.equal(peak, 4);
});

test("three consecutive failures open the breaker for that URL for 10 minutes", async () => {
  let now = 1_000_000;
  const q = createDeliveryQueue({ concurrency: 4, now: () => now });
  const bad = "https://down.example/";
  let calls = 0;
  const fail = async () => {
    calls++;
    throw new Error("down");
  };
  for (let i = 0; i < 3; i++) {
    q.enqueue(bad, fail);
    await q.idle();
  }
  assert.equal(calls, 3);
  assert.equal(q.enqueue(bad, fail), false, "skipped while open");
  assert.equal(q.enqueue("https://other.example/", async () => {}), true, "other URLs unaffected");
  await q.idle();
  assert.equal(calls, 3);

  now += 10 * 60_000 + 1;
  assert.equal(q.enqueue(bad, fail), true, "retried after the cooldown");
  await q.idle();
  assert.equal(calls, 4);
});

test("a success resets the failure count", async () => {
  const q = createDeliveryQueue({ concurrency: 1 });
  const url = "https://flaky.example/";
  let n = 0;
  const flaky = async () => {
    n++;
    if (n % 3 !== 0) throw new Error("x");
  };
  for (let i = 0; i < 6; i++) {
    assert.equal(q.enqueue(url, flaky), true, `attempt ${i}`);
    await q.idle();
  }
});

test("the pending queue is bounded", async () => {
  const q = createDeliveryQueue({ concurrency: 1, maxPending: 2 });
  const never = () => new Promise<void>(() => {});
  assert.equal(q.enqueue("https://a.example/", never), true); // running
  assert.equal(q.enqueue("https://a.example/", never), true); // pending 1
  assert.equal(q.enqueue("https://a.example/", never), true); // pending 2
  assert.equal(q.enqueue("https://a.example/", never), false); // dropped
});
