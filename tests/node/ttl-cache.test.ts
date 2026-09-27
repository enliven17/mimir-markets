import test from "node:test";
import assert from "node:assert/strict";

import { cachedFor } from "../../lib/server/ttl-cache";

test("cachedFor dedupes within the TTL but does not cache failures", async () => {
  let calls = 0;
  let fail = true;
  const fn = cachedFor(async (x: number) => {
    calls++;
    if (fail) throw new Error("boom");
    return x * 2;
  }, 60_000);

  await assert.rejects(fn(2));
  await new Promise((r) => setImmediate(r));
  fail = false;
  assert.equal(await fn(2), 4, "a failure is retried, not served for the TTL");
  assert.equal(await fn(2), 4);
  assert.equal(calls, 2);
});

test("cachedFor re-runs after the TTL and keys by arguments", async () => {
  let calls = 0;
  const fn = cachedFor(async (x: number) => {
    calls++;
    return x;
  }, 20);

  await fn(1);
  await fn(1);
  await fn(2);
  assert.equal(calls, 2, "same args share one call, other args get their own");
  await new Promise((r) => setTimeout(r, 30));
  await fn(1);
  assert.equal(calls, 3, "an expired entry is fetched again");
});
