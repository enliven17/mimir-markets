import assert from "node:assert/strict";
import test from "node:test";

import { allowLlmRequest, parseClaimDraftBody } from "../../lib/server/llm-route-guard";
import { resetMemoryRateLimits } from "../../lib/server/rate-limit";

delete process.env.DATABASE_URL;

test("LLM routes have a deploy-wide cap that rotating IPs cannot bypass", async () => {
  resetMemoryRateLimits();
  process.env.TEST_GLOBAL_PER_MIN = "2";
  try {
    const gate = (ip: string) =>
      allowLlmRequest({ bucket: "t-llm", key: ip, perKey: 20, globalEnv: "TEST_GLOBAL_PER_MIN", globalDefault: 100 });
    assert.equal(await gate("203.0.113.1"), true);
    assert.equal(await gate("203.0.113.2"), true);
    assert.equal(await gate("203.0.113.3"), false, "a fresh IP still hits the global ceiling");
  } finally {
    delete process.env.TEST_GLOBAL_PER_MIN;
  }
});

test("the per-caller limit still applies under the global ceiling", async () => {
  resetMemoryRateLimits();
  const gate = () =>
    allowLlmRequest({ bucket: "t-llm2", key: "203.0.113.1", perKey: 1, globalEnv: "UNSET_GLOBAL", globalDefault: 100 });
  assert.equal(await gate(), true);
  assert.equal(await gate(), false);
});

test("holder pools have their own deploy-wide ceiling", async () => {
  resetMemoryRateLimits();
  const gate = (key: string, pool: string) =>
    allowLlmRequest({ bucket: "t-llm3", key, perKey: 10, globalEnv: "UNSET_GLOBAL", globalDefault: 1, pool });
  assert.equal(await gate("a", "all"), true);
  assert.equal(await gate("b", "all"), false);
  assert.equal(await gate("wallet:x", "holders"), true);
});

test("claim-draft body: URL capped at the on-chain 200 bytes", () => {
  assert.deepEqual(parseClaimDraftBody({ url: " https://example.com/a ", locale: "es" }), {
    url: "https://example.com/a",
    locale: "es",
  });
  assert.deepEqual(parseClaimDraftBody({}), { error: "url is required" });
  assert.deepEqual(parseClaimDraftBody(null), { error: "url is required" });
  const r = parseClaimDraftBody({ url: `https://example.com/${"a".repeat(200)}` });
  assert.ok("error" in r && /200 bytes/.test(r.error));
});
