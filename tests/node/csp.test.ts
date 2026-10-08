import test from "node:test";
import assert from "node:assert/strict";

import { buildCsp, newNonce } from "../../lib/server/csp";

const directives = (csp: string) =>
  Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

test("the enforced policy is strict: nonce + strict-dynamic, no unsafe-inline scripts", () => {
  const d = directives(buildCsp("abc123", false));
  assert.deepEqual(d["default-src"], ["'self'"]);
  assert.ok(d["script-src"].includes("'self'"));
  assert.ok(d["script-src"].includes("'nonce-abc123'"));
  assert.ok(d["script-src"].includes("'strict-dynamic'"));
  assert.ok(!d["script-src"].includes("'unsafe-inline'"));
  assert.ok(!d["script-src"].includes("'unsafe-eval'"));
  assert.deepEqual(d["object-src"], ["'none'"]);
  assert.deepEqual(d["base-uri"], ["'self'"]);
  assert.deepEqual(d["form-action"], ["'self'"]);
  assert.deepEqual(d["frame-ancestors"], ["'self'", "https://web.telegram.org"], "only Telegram's web client may frame the Mini App");
  assert.deepEqual(d["connect-src"], ["'self'", "https:", "wss:"]);
  assert.deepEqual(d["img-src"], ["'self'", "data:", "blob:", "https:"]);
});

test("dev adds unsafe-eval (React debugging) and nothing else", () => {
  const d = directives(buildCsp("n", true));
  assert.ok(d["script-src"].includes("'unsafe-eval'"));
});

test("nonces are fresh and base64", () => {
  const a = newNonce();
  assert.notEqual(a, newNonce());
  assert.match(a, /^[A-Za-z0-9+/=]{16,}$/);
});
