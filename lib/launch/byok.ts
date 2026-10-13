/**
 * Mimir Launch: an owner's own LLM key ("bring your own key"). The key is sealed with AES-256-GCM under a server
 * secret (LAUNCH_BYOK_SECRET) and bound to the agent's id as associated data, so a sealed key copied onto another
 * agent's record does not open. Only the last four characters ever go back to a browser. The router speaks to the
 * provider directly with that key and has the same shape as the platform one (llm.ts), so the engine cannot tell
 * which it is using. A key that fails pauses the agent upstream; it never falls back to Mimir's keys silently.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { JsonRouter } from "./engine/rank";
import { BYOK_PROVIDERS, type ByokProvider } from "./byok-providers";

export { BYOK_PROVIDERS, type ByokProvider };

export const isByokProvider = (v: unknown): v is ByokProvider => typeof v === "string" && v in BYOK_PROVIDERS;

export interface SealedKey {
  provider: ByokProvider;
  /** base64(iv[12] | tag[16] | ciphertext) */
  sealed: string;
  /** What the owner sees: the last four characters. */
  last4: string;
  /** The model to call; the provider's default when not chosen. */
  model: string;
}

function masterKey(secret = process.env.LAUNCH_BYOK_SECRET): Buffer {
  const s = secret?.trim();
  if (!s || s.length < 32) throw new Error("LAUNCH_BYOK_SECRET is not set (32+ characters)");
  return createHash("sha256").update(s).digest();
}

export function sealKey(agentId: string, provider: ByokProvider, apiKey: string, model?: string, secret?: string): SealedKey {
  const key = apiKey.trim();
  if (key.length < 16 || key.length > 400 || /\s/.test(key)) throw new Error("that does not look like an API key");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(secret), iv);
  c.setAAD(Buffer.from(`mimir-launch:${agentId}:${provider}`));
  const ct = Buffer.concat([c.update(key, "utf8"), c.final()]);
  return { provider, sealed: Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64"), last4: key.slice(-4), model: model?.trim() || BYOK_PROVIDERS[provider].model };
}

/** The plain key, server side only; throws when the record was tampered with, moved to another agent or the secret changed. */
export function openKey(agentId: string, k: SealedKey, secret?: string): string {
  const raw = Buffer.from(k.sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", masterKey(secret), raw.subarray(0, 12));
  d.setAAD(Buffer.from(`mimir-launch:${agentId}:${k.provider}`));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** One completion against the owner's provider; returns the reply text. */
export async function byokComplete(provider: ByokProvider, apiKey: string, model: string, system: string, user: string, opts: { maxTokens?: number; temperature?: number; json?: boolean; fetch?: Fetch } = {}): Promise<string> {
  const f = opts.fetch ?? fetch;
  const maxTokens = opts.maxTokens ?? 1024, temperature = opts.temperature ?? 0;
  const signal = AbortSignal.timeout(60_000); // reasoning models can think for a while
  if (provider === "anthropic") {
    const res = await f("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  }
  if (provider === "gemini") {
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature, ...(opts.json ? { responseMimeType: "application/json" } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }
  // OpenAI, Groq and OpenRouter speak the same chat-completions API.
  const base = provider === "openai" ? "https://api.openai.com/v1" : provider === "groq" ? "https://api.groq.com/openai/v1" : "https://openrouter.ai/api/v1";
  const res = await f(`${base}/chat/completions`, {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, temperature, max_tokens: maxTokens,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? "";
}

const firstJson = (text: string): string | null => {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  return a >= 0 && b > a ? text.slice(a, b + 1) : null;
};

/** The agent's brain on the owner's key. */
export function byokRouter(agentId: string, k: SealedKey, opts: { fetch?: Fetch; secret?: string } = {}): JsonRouter {
  return {
    async completeJson(o, parse) {
      const text = await byokComplete(k.provider, openKey(agentId, k, opts.secret), k.model, o.system, o.user, { maxTokens: o.maxTokens, temperature: o.temperature, json: o.json, fetch: opts.fetch });
      const json = firstJson(text);
      if (!json) throw new Error(`${k.provider}: no JSON in the reply`);
      return { data: parse(JSON.parse(json)), provider: k.provider, model: k.model };
    },
  };
}

/**
 * One small call to check a key before it is saved: "ok", "bad-key" (the provider refused it: 401/403) or "busy"
 * (rate limit, quota, outage: the key may be fine, it just cannot be checked now). Room for 512 tokens: reasoning
 * models spend a few hundred thinking before they answer, and a tight cap returns an empty reply for a good key.
 */
export async function checkKey(provider: ByokProvider, apiKey: string, model: string, f?: Fetch): Promise<"ok" | "bad-key" | "busy"> {
  try {
    const text = await byokComplete(provider, apiKey, model, "Reply with the single word ok.", "ok?", { maxTokens: 512, fetch: f });
    return text.trim().length > 0 ? "ok" : "busy";
  } catch (err) {
    return / (400|401|403|404)$/.test(err instanceof Error ? err.message : "") ? "bad-key" : "busy";
  }
}
