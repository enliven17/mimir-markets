import assert from "node:assert/strict";
import test from "node:test";

import { MAX_BODY_BYTES, readLimitedJson } from "../../lib/server/body-limit";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

test("a normal JSON body parses", async () => {
  const r = await readLimitedJson(post(JSON.stringify({ a: 1 })));
  assert.deepEqual(r, { ok: true, value: { a: 1 } });
});

test("a declared Content-Length over the cap is rejected before reading", async () => {
  let pulls = 0;
  const stream = new ReadableStream({
    pull(c) {
      pulls++;
      c.enqueue(new TextEncoder().encode("x".repeat(1024)));
    },
  });
  const r = await readLimitedJson(post(stream, { "content-length": String(MAX_BODY_BYTES + 1) }));
  assert.deepEqual(r, { ok: false, status: 413 });
  // The runtime may prefetch a chunk; the reader itself never drains the body.
  assert.ok(pulls <= 2, `body was read (${pulls} pulls)`);
  assert.deepEqual(await readLimitedJson(post("{}", { "content-length": "abc" })), { ok: false, status: 413 });
});

test("a body that streams past the cap is rejected even without Content-Length", async () => {
  const chunk = new TextEncoder().encode("x".repeat(4096));
  let sent = 0;
  const stream = new ReadableStream({
    pull(c) {
      c.enqueue(chunk);
      sent += chunk.length;
      if (sent > 1_000_000) c.close();
    },
  });
  const r = await readLimitedJson(post(stream));
  assert.deepEqual(r, { ok: false, status: 413 });
  assert.ok(sent < 100_000, "reading stops soon after the cap");
});

test("a lying small Content-Length does not lift the cap", async () => {
  const big = JSON.stringify({ q: "x".repeat(MAX_BODY_BYTES) });
  const r = await readLimitedJson(post(big), 1024);
  assert.deepEqual(r, { ok: false, status: 413 });
});

test("malformed JSON and empty bodies are a 400", async () => {
  assert.deepEqual(await readLimitedJson(post("{nope")), { ok: false, status: 400 });
  assert.deepEqual(await readLimitedJson(post(null)), { ok: false, status: 400 });
});
