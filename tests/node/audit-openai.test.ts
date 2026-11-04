import assert from "node:assert/strict";
import test from "node:test";
import { auditOpenAIConfig, callAuditOpenAI } from "../../agents/audit/openai-compat";

test("OpenAI-compatible audit model needs base, key and model together, over https", () => {
  assert.equal(auditOpenAIConfig({}), null);
  assert.throws(() => auditOpenAIConfig({ AUDIT_OPENAI_API_KEY: "k" }), /go together/);
  assert.throws(() => auditOpenAIConfig({ AUDIT_OPENAI_BASE_URL: "http://x", AUDIT_OPENAI_API_KEY: "k", AUDIT_LLM_MODEL: "m" }), /https/);
  assert.deepEqual(auditOpenAIConfig({ AUDIT_OPENAI_BASE_URL: "https://x/v1/", AUDIT_OPENAI_API_KEY: "k", AUDIT_LLM_MODEL: "m" }), { base: "https://x/v1", key: "k", model: "m" });
});

test("audit call posts the prompt and rejects empty or failed answers", async () => {
  const cfg = { base: "https://x/v1", key: "k", model: "m" };
  const original = globalThis.fetch;
  let seen: { url: string; body: any; auth: string } | undefined;
  try {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization };
      return new Response(JSON.stringify({ model: "m-1", choices: [{ message: { content: '{"verdict":"DRAW"}' } }] }));
    }) as typeof fetch;
    const out = await callAuditOpenAI("hello", { temperature: 0 }, cfg);
    assert.deepEqual(out, { text: '{"verdict":"DRAW"}', provider: "openai-compat", model: "m-1" });
    assert.equal(seen?.url, "https://x/v1/chat/completions");
    assert.equal(seen?.auth, "Bearer k");
    assert.equal(seen?.body.messages[0].content, "hello");
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [] }))) as typeof fetch;
    await assert.rejects(callAuditOpenAI("x", {}, cfg), /no content/);
    globalThis.fetch = (async () => new Response("no", { status: 429 })) as typeof fetch;
    await assert.rejects(callAuditOpenAI("x", {}, cfg), /429/);
  } finally { globalThis.fetch = original; }
});
