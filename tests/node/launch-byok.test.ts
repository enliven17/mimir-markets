import assert from "node:assert/strict";
import { test } from "node:test";

import { byokRouter, checkKey, openKey, sealKey } from "../../lib/launch/byok";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const KEY = "sk-test-0123456789abcdefWXYZ";

test("a sealed key opens only for its own agent, provider and secret; the owner sees four characters", () => {
  const k = sealKey("agent-1", "openai", KEY, undefined, SECRET);
  assert.equal(k.last4, "WXYZ");
  assert.ok(!k.sealed.includes(KEY));
  assert.equal(openKey("agent-1", k, SECRET), KEY);
  assert.throws(() => openKey("agent-2", k, SECRET));
  assert.throws(() => openKey("agent-1", { ...k, provider: "groq" }, SECRET));
  assert.throws(() => openKey("agent-1", k, `${SECRET}-rotated`));
  const tampered = Buffer.from(k.sealed, "base64"); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => openKey("agent-1", { ...k, sealed: tampered.toString("base64") }, SECRET));
});

test("no secret, or a key that does not look like one, is refused", () => {
  assert.throws(() => sealKey("a", "openai", KEY, undefined, "short"));
  assert.throws(() => sealKey("a", "openai", "not a key", undefined, SECRET));
});

test("the router calls the owner's provider with the owner's key and parses the JSON", async () => {
  const k = sealKey("agent-1", "anthropic", KEY, undefined, SECRET);
  let seen: { url: string; key: string | null } | null = null;
  const fake = async (url: string, init: RequestInit) => {
    seen = { url, key: new Headers(init.headers).get("x-api-key") };
    return new Response(JSON.stringify({ content: [{ type: "text", text: 'sure: {"scores":[]}' }] }), { status: 200 });
  };
  const res = await byokRouter("agent-1", k, { fetch: fake, secret: SECRET }).completeJson({ system: "s", user: "u", json: true }, (v) => v as { scores: unknown[] });
  assert.deepEqual(res.data, { scores: [] });
  assert.equal(seen!.url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen!.key, KEY);
});

test("checkKey: refused, busy or ok; room for a reasoning model to think", async () => {
  assert.equal(await checkKey("openai", KEY, "gpt-5-mini", async () => new Response("no", { status: 401 })), "bad-key");
  assert.equal(await checkKey("gemini", KEY, "m", async () => new Response("quota", { status: 429 })), "busy");
  let maxTokens = 0;
  const good = async (_u: string, init: RequestInit) => ((maxTokens = JSON.parse(String(init.body)).max_tokens), new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
  assert.equal(await checkKey("groq", KEY, "m", good), "ok");
  assert.ok(maxTokens >= 256);
  // An empty reply (a model that ran out of room) is "busy", never a saved key that cannot answer.
  assert.equal(await checkKey("groq", KEY, "m", async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 })), "busy");
});
