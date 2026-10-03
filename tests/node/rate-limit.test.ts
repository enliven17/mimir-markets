import assert from "node:assert/strict";
import test from "node:test";

import { allowRequest, clientIp, resetMemoryRateLimits, trustedProxyHops, envLimit } from "../../lib/server/rate-limit";

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

test("clientIp takes the proxy-appended (rightmost) forwarded address, not the spoofable leftmost", () => {
  const req = new Request("http://x", { headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4", "x-real-ip": "9.9.9.9" } });
  assert.equal(clientIp(req, 1), "1.2.3.4");
  assert.equal(clientIp(req, 2), "6.6.6.6");
  // Rotating a forged leftmost value does not change the key.
  const forged = new Request("http://x", { headers: { "x-forwarded-for": "7.7.7.7, 1.2.3.4" } });
  assert.equal(clientIp(forged, 1), "1.2.3.4");
});

test("clientIp falls back to x-real-ip when the chain is shorter than the trusted hops", () => {
  const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" } });
  assert.equal(clientIp(req, 2), "9.9.9.9");
  assert.equal(clientIp(req, 0), "9.9.9.9", "0 hops ignores X-Forwarded-For");
  assert.equal(clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }), 1), "9.9.9.9");
  assert.equal(clientIp(new Request("http://x"), 1), "unknown");
});

test("TRUSTED_PROXY_HOPS parses strictly with a default of 1", () => {
  assert.equal(trustedProxyHops({}), 1);
  assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: "2" }), 2);
  assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: "0" }), 0);
  assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: "-1" }), 1);
  assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: "abc" }), 1);
});

test("envLimit reads a positive integer or keeps the default", () => {
  assert.equal(envLimit("X_PER_MIN", 30, {}), 30);
  assert.equal(envLimit("X_PER_MIN", 30, { X_PER_MIN: "5" }), 5);
  assert.equal(envLimit("X_PER_MIN", 30, { X_PER_MIN: "0" }), 30);
  assert.equal(envLimit("X_PER_MIN", 30, { X_PER_MIN: "lots" }), 30);
});
