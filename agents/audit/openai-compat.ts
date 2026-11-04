/**
 * Optional OpenAI-compatible model for the audit worker (e.g. DeepSeek via Token Harbor):
 * AUDIT_OPENAI_BASE_URL + AUDIT_OPENAI_API_KEY + AUDIT_LLM_MODEL. A different provider from the
 * proposer's Gemini keys, so the auditor's errors are less correlated with the oracle's.
 */
import type { CallLLMOptions } from "../../lib/llm";

export function auditOpenAIConfig(e: Record<string, string | undefined> = process.env) {
  const base = e.AUDIT_OPENAI_BASE_URL?.trim().replace(/\/+$/, ""), key = e.AUDIT_OPENAI_API_KEY?.trim(), model = e.AUDIT_LLM_MODEL?.trim();
  if (!base && !key) return null;
  if (!base || !key || !model) throw Error("AUDIT_OPENAI_BASE_URL, AUDIT_OPENAI_API_KEY and AUDIT_LLM_MODEL go together");
  if (!/^https:\/\//.test(base)) throw Error("AUDIT_OPENAI_BASE_URL must be https");
  return { base, key, model };
}

export async function callAuditOpenAI(prompt: string, opts: CallLLMOptions, cfg = auditOpenAIConfig()): Promise<{ text: string; provider: string; model: string }> {
  if (!cfg) throw Error("No OpenAI-compatible audit model configured");
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], temperature: opts.temperature ?? 0, max_tokens: Math.max(opts.maxTokens ?? 1024, 16_384) }), // reasoning models spend most of it thinking
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw Error(`audit model HTTP ${res.status}`);
  const body = await res.json() as { model?: string; choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw Error(`audit model returned no content (${JSON.stringify(body).slice(0, 300)})`);
  return { text, provider: "openai-compat", model: body.model || cfg.model };
}
