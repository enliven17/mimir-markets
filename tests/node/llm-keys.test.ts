import assert from "node:assert/strict";
import test from "node:test";

import { activeLLMProvider, geminiKeyFor } from "../../lib/llm";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("each worker reads its own Gemini key without touching the shared one", () => {
  withEnv({ GEMINI_API_KEY: "shared", ORACLE_GEMINI_API_KEY: " oracle ", COUNCIL_GEMINI_API_KEY: "council" }, () => {
    assert.equal(geminiKeyFor("ORACLE_GEMINI_API_KEY"), "oracle");
    assert.equal(geminiKeyFor("COUNCIL_GEMINI_API_KEY"), "council");
    assert.equal(geminiKeyFor(), "shared");
    assert.equal(process.env.GEMINI_API_KEY, "shared");
  });
});

test("a worker without its own key falls back to GEMINI_API_KEY", () => {
  withEnv({ GEMINI_API_KEY: "shared", ORACLE_GEMINI_API_KEY: undefined }, () => {
    assert.equal(geminiKeyFor("ORACLE_GEMINI_API_KEY"), "shared");
  });
});

test("a worker-only Gemini key still selects the Gemini provider", () => {
  withEnv({ GEMINI_API_KEY: undefined, ANTHROPIC_API_KEY: "a", LLM_PROVIDER: undefined, ORACLE_GEMINI_API_KEY: "o" }, () => {
    assert.equal(activeLLMProvider("ORACLE_GEMINI_API_KEY"), "gemini");
    assert.equal(activeLLMProvider(), "anthropic");
  });
});

test("settlement calls never reach the OpenRouter free router", async () => {
  const { providerChain } = await import("../../lib/llm");
  withEnv(
    { GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "o", OPENROUTER_MODEL: undefined, LLM_PROVIDER: undefined, GROQ_API_KEY: undefined, GROQ_API_KEYS: undefined, ANTHROPIC_API_KEY: undefined },
    () => {
      assert.deepEqual(providerChain(), ["gemini", "openrouter"]);
      assert.deepEqual(providerChain({ noFreeRouter: true }), ["gemini"]);
    },
  );
});

test("oracle role: dedicated key only on mainnet, shared fallback off mainnet", async () => {
  const { geminiKeysFor, anthropicKeyFor, providerChain } = await import("../../lib/llm");
  withEnv(
    { GEMINI_API_KEY: "shared", GEMINI_API_KEYS: undefined, ORACLE_GEMINI_API_KEY: undefined, ANTHROPIC_API_KEY: "a-shared", ORACLE_ANTHROPIC_API_KEY: undefined, LLM_PROVIDER: undefined, GROQ_API_KEY: "q", OPENROUTER_API_KEY: "o" },
    () => {
      assert.deepEqual(geminiKeysFor({ role: "oracle", mainnet: true }), []);
      assert.equal(anthropicKeyFor({ role: "oracle", mainnet: true }), "");
      assert.deepEqual(providerChain({ role: "oracle", mainnet: true, settlement: true }), [], "no own key on mainnet: nothing to call");
      assert.deepEqual(geminiKeysFor({ role: "oracle", mainnet: false }), ["shared"]);
      assert.deepEqual(providerChain({ role: "oracle", mainnet: false }), ["gemini", "anthropic"], "never Groq/OpenRouter");
    },
  );
  withEnv({ GEMINI_API_KEY: "shared", ORACLE_GEMINI_API_KEY: "oracle-key" }, () => {
    assert.deepEqual(geminiKeysFor({ role: "oracle", mainnet: true }), ["oracle-key"]);
  });
});

test("web and council roles never spend an oracle key", async () => {
  const { geminiKeysFor, anthropicKeyFor } = await import("../../lib/llm");
  withEnv({ GEMINI_API_KEY: "same", GEMINI_API_KEYS: "other", ORACLE_GEMINI_API_KEY: "same", COUNCIL_GEMINI_API_KEY: "c", ANTHROPIC_API_KEY: "ak", ORACLE_ANTHROPIC_API_KEY: "ak" }, () => {
    assert.deepEqual(geminiKeysFor({ keyEnv: "COUNCIL_GEMINI_API_KEY", mainnet: true }), ["c", "other"]);
    assert.deepEqual(geminiKeysFor({ role: "web", keyEnv: "ORACLE_GEMINI_API_KEY", mainnet: true }), ["other"], "naming the oracle env does not grant it");
    assert.deepEqual(geminiKeysFor({ role: "web", mainnet: false }), ["same", "other"], "off mainnet one shared key may serve everything");
    assert.equal(anthropicKeyFor({ role: "web", mainnet: false }), "");
  });
});

test("settlement uses only allowlisted Gemini/Claude models", async () => {
  const { isSettlementModel, settlementModels, providerChain } = await import("../../lib/llm");
  withEnv({ SETTLEMENT_MODELS: undefined }, () => {
    assert.ok(isSettlementModel("gemini-3.5-flash"));
    assert.ok(isSettlementModel("claude-sonnet-4-6"));
    assert.equal(isSettlementModel("llama-3.3-70b-versatile"), false);
    assert.equal(isSettlementModel("gemma-3-27b-it"), false);
  });
  withEnv({ SETTLEMENT_MODELS: "gemma-3-27b-it, meta/llama:free, gemini-x:free, claude-sonnet-4-6" }, () => {
    assert.deepEqual(settlementModels(), ["claude-sonnet-4-6"], "gemma and :free never make the list");
  });
  withEnv(
    { SETTLEMENT_MODELS: "claude-sonnet-4-6", GEMINI_API_KEY: "g", ORACLE_GEMINI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, ORACLE_ANTHROPIC_API_KEY: undefined, LLM_PROVIDER: undefined },
    () => {
      assert.deepEqual(providerChain({ role: "oracle", mainnet: false, settlement: true }), [], "no allowed Gemini model, no Claude key");
    },
  );
});

test("settlement calls with no allowed model throw (retry later) instead of falling back", async () => {
  const { callLLMWithMeta } = await import("../../lib/llm");
  const env = { GEMINI_API_KEY: undefined, GEMINI_API_KEYS: undefined, ORACLE_GEMINI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, ORACLE_ANTHROPIC_API_KEY: undefined, GROQ_API_KEY: "q", LLM_PROVIDER: undefined };
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await assert.rejects(callLLMWithMeta("x", { role: "oracle", settlement: true, mainnet: false }), /settlement-grade/);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("key logs carry a hash prefix, never the key's tail", async () => {
  const { activeLLMKeyFingerprint } = await import("../../lib/llm");
  withEnv({ GEMINI_API_KEY: "AIzaSECRETabcdef", LLM_PROVIDER: undefined }, () => {
    const fp = activeLLMKeyFingerprint();
    assert.match(fp, /^sha256:[0-9a-f]{8}$/);
    assert.ok(!fp.includes("abcdef"));
  });
});

test("terminal chat tries the free tiers first; settlement never does", async () => {
  const { providerChain } = await import("../../lib/llm");
  withEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", OPENROUTER_API_KEY: "o", ANTHROPIC_API_KEY: undefined, LLM_PROVIDER: undefined }, () => {
    assert.deepEqual(providerChain({ preferFree: true, mainnet: false }), ["groq", "openrouter", "gemini"]);
    assert.equal(providerChain({ mainnet: false })[0], "gemini", "everything else keeps its order");
    assert.ok(!providerChain({ preferFree: true, settlement: true, mainnet: false }).includes("groq"));
  });
});
