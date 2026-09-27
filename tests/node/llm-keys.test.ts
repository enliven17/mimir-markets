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
