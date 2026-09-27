import assert from "node:assert/strict";
import test from "node:test";

import { allowRequest, clientIp, resetMemoryRateLimits } from "../../lib/server/rate-limit";

delete process.env.DATABASE_URL;

test("counts per key in memory without a database", async () => {
  resetMemoryRateLimits();
  const now = 1_000_000;
  assert.equal(await allowRequest("t", "a", 2, 60_000, now), true);
  assert.equal(await allowRequest("t", "a", 2, 60_000, now + 1), true);
  assert.equal(await allowRequest("t", "a", 2, 60_000, now + 2), false);
  // Another key and another bucket have their own counters.
  assert.equal(await allowRequest("t", "b", 2, 60_000, now), true);
  assert.equal(await allowRequest("u", "a", 2, 60_000, now), true);
});

test("a new window resets the count", async () => {
  resetMemoryRateLimits();
  const start = 60_000 * 10;
  assert.equal(await allowRequest("t", "a", 1, 60_000, start), true);
  assert.equal(await allowRequest("t", "a", 1, 60_000, start + 59_999), false);
  assert.equal(await allowRequest("t", "a", 1, 60_000, start + 60_000), true);
});

test("clientIp prefers the first forwarded address", () => {
  const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1", "x-real-ip": "9.9.9.9" } });
  assert.equal(clientIp(req), "1.2.3.4");
  assert.equal(clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } })), "9.9.9.9");
  assert.equal(clientIp(new Request("http://x")), "unknown");
});
