/**
 * Provider-agnostic LLM calls for Mimir agents.
 *
 * Providers: Gemini, Claude, Groq, OpenRouter. The primary one is picked from
 * the configured keys (or forced with LLM_PROVIDER=gemini|anthropic|groq|openrouter);
 * when it fails or sits in a quota cooldown the call falls back through the
 * others that have a key.
 *
 * Per-worker Gemini keys: a worker passes `keyEnv` (e.g. COUNCIL_GEMINI_API_KEY)
 * and its calls use that key first, then GEMINI_API_KEY and GEMINI_API_KEYS.
 * Nothing mutates process.env, so several workers in one process
 * (agents/all.ts) each keep their own key and cooldowns.
 *
 * Roles keep the oracle's quota apart from anything the web can trigger:
 *   - role "oracle" reads ORACLE_GEMINI_API_KEY / ORACLE_ANTHROPIC_API_KEY; on
 *     mainnet ONLY those (no shared-key fallback, so a flood of web calls can
 *     never stall settlement); off mainnet it may fall back to the shared keys.
 *   - every other role ("council", "web", the default) never reads an oracle
 *     key, even when the same key is also set as a shared one.
 *
 * Settlement calls pass `settlement`: only models on the SETTLEMENT_MODELS
 * allowlist (Gemini / Claude; never Groq, OpenRouter, ":free" or Gemma). With
 * none available the call throws and the oracle retries later.
 * `callLLMWithMeta` returns the provider/model that actually answered, for the
 * verdict audit bundle. Logs never carry key material, only a hash prefix.
 *
 *   import { callLLM } from "@/lib/llm";
 *   const text = await callLLM(prompt, { maxTokens: 512, jsonOnly: true });
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { IS_MAINNET } from "./solana/config";

export type LLMProvider = "gemini" | "anthropic" | "groq" | "openrouter";

/** Who is calling: decides which keys a call may spend. */
export type LLMRole = "oracle" | "council" | "web";

export const ORACLE_GEMINI_KEY_ENV = "ORACLE_GEMINI_API_KEY";
export const ORACLE_ANTHROPIC_KEY_ENV = "ORACLE_ANTHROPIC_API_KEY";

export interface CallLLMOptions {
  /** Max output tokens. Defaults to 1024. */
  maxTokens?: number;
  /** Sampling temperature 0–1. Defaults to 0.2 (deterministic). */
  temperature?: number;
  /** Ask the model for JSON output. Gemini uses responseMimeType; others are hinted. */
  jsonOnly?: boolean;
  /** Gemini responseSchema: makes the JSON grammar strict. Ignored elsewhere and by Gemma. */
  jsonSchema?: Record<string, unknown>;
  /** Preferred Gemini model for this call; the rest of GEMINI_MODELS is the fallback pool. */
  model?: string;
  /** Env var holding this caller's own Gemini key; falls back to GEMINI_API_KEY(S). */
  keyEnv?: string;
  /** Skip the OpenRouter free router (settlement verdicts must know their model). */
  noFreeRouter?: boolean;
  /** Which keys this call may spend. Default "web": never an oracle key. */
  role?: LLMRole;
  /** Settlement-grade models only (SETTLEMENT_MODELS); throws when none is available. */
  settlement?: boolean;
  /** Cluster override for tests; defaults to IS_MAINNET. */
  mainnet?: boolean;
  /**
   * Low-stakes chat (the terminal): free-tier providers first (Groq, then
   * OpenRouter's free models), the paid ones only as a fallback. Never with settlement.
   */
  preferFree?: boolean;
}

export interface LLMCallRecord {
  provider: LLMProvider;
  model: string;
}

export interface LLMResult extends LLMCallRecord {
  text: string;
}

let lastCall: LLMCallRecord | null = null;

/**
 * Which provider and model answered the most recent successful call,
 * process-wide. Not for audit records (concurrent callers race on it): use
 * callLLMWithMeta.
 */
export function lastLLMCall(): LLMCallRecord | null {
  return lastCall;
}

/** ORACLE_LLM_MODEL only overrides the provider its id belongs to. */
function overrideFor(prefixes: string[]): string | undefined {
  const id = process.env.ORACLE_LLM_MODEL?.trim();
  return id && prefixes.some((p) => id.startsWith(p)) ? id : undefined;
}

const DEFAULT_GEMINI_MODEL = overrideFor(["gemini", "gemma"]) || "gemini-3.5-flash";
const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL?.trim() || overrideFor(["claude"]) || "claude-sonnet-4-6";
const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL?.trim() || "openrouter/free";
/** The models settlement verdicts may come from, unless SETTLEMENT_MODELS says otherwise. */
const SETTLEMENT_DEFAULT_MODELS = "gemini-3.5-flash,gemini-3.5-pro,claude-sonnet-4-6";

const GEMINI_QUOTA_COOLDOWN_MS = Number(process.env.LLM_QUOTA_COOLDOWN_MS ?? "300000"); // 5 min
const GROQ_QUOTA_COOLDOWN_MS = Number(process.env.GROQ_QUOTA_COOLDOWN_MS ?? "2700000"); // 45 min
const OPENROUTER_QUOTA_COOLDOWN_MS = Number(process.env.OPENROUTER_QUOTA_COOLDOWN_MS ?? "2700000");

const anthropicClients = new Map<string, Anthropic>();
let openrouterCooldownUntil = 0;
const groqCooldownByKey = new Map<string, number>();
/** `${keyId}|${model}` → until: Gemini limits are per key per model. */
const geminiCooldownByCombo = new Map<string, number>();

const remaining = (until: number): number => Math.max(0, until - Date.now());
/** A key's id for maps and logs: a hash prefix, never key material. */
const keyId = (key: string): string => createHash("sha256").update(key).digest("hex").slice(0, 8);

function splitList(...values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const v of values.flatMap((x) => (x ?? "").split(/[,\s]+/))) {
    const k = v.trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * GEMINI_API_KEY for web routes that call Gemini directly (moderation, source
 * drafts), or "" on mainnet when it is the oracle's own key: public traffic
 * must never spend the settlement quota.
 */
export function webGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  const oracle = process.env[ORACLE_GEMINI_KEY_ENV]?.trim();
  if (IS_MAINNET && key && oracle && key === oracle) {
    console.error("[llm] GEMINI_API_KEY equals ORACLE_GEMINI_API_KEY: web routes will not use it");
    return "";
  }
  return key;
}

/** The Gemini key a caller uses first: its own `keyEnv` when set, else GEMINI_API_KEY. */
export function geminiKeyFor(keyEnv?: string): string {
  return (keyEnv ? process.env[keyEnv]?.trim() : "") || process.env.GEMINI_API_KEY?.trim() || "";
}

interface KeyScope {
  role: LLMRole;
  keyEnv?: string;
  mainnet: boolean;
}

type ScopeOpts = Pick<CallLLMOptions, "role" | "keyEnv" | "mainnet">;

function scopeOf(opts: ScopeOpts = {}): KeyScope {
  return { role: opts.role ?? "web", keyEnv: opts.keyEnv, mainnet: opts.mainnet ?? IS_MAINNET };
}

const envKey = (name: string): string => process.env[name]?.trim() ?? "";
const isOracleEnv = (name: string | undefined): boolean => Boolean(name?.toUpperCase().startsWith("ORACLE_"));

/**
 * The Gemini keys a call may use, its own first. Oracle: the dedicated key,
 * plus the shared ones only off mainnet. Everyone else: never the oracle key
 * on mainnet (off mainnet one shared key may serve everything).
 */
export function geminiKeysFor(opts: ScopeOpts = {}): string[] {
  const scope = scopeOf(opts);
  if (scope.role === "oracle") {
    const own = envKey(scope.keyEnv ?? ORACLE_GEMINI_KEY_ENV);
    return scope.mainnet ? splitList(own) : splitList(own, process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEYS);
  }
  const oracleKey = envKey(ORACLE_GEMINI_KEY_ENV);
  const own = scope.keyEnv && !isOracleEnv(scope.keyEnv) ? envKey(scope.keyEnv) : "";
  return splitList(own, process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEYS).filter((k) => !scope.mainnet || k !== oracleKey);
}

/** The Anthropic key a call may use (same rules as Gemini); "" when none. */
export function anthropicKeyFor(opts: ScopeOpts = {}): string {
  const scope = scopeOf(opts);
  const own = envKey(ORACLE_ANTHROPIC_KEY_ENV);
  const shared = envKey("ANTHROPIC_API_KEY");
  if (scope.role === "oracle") return own || (scope.mainnet ? "" : shared);
  return shared && shared !== own ? shared : "";
}

function geminiModelPool(): string[] {
  const pool = splitList(process.env.GEMINI_MODELS);
  return pool.length > 0 ? pool : [DEFAULT_GEMINI_MODEL];
}

/** Stable model assignment for an agent/persona seed: spreads load across GEMINI_MODELS. */
export function pickGeminiModel(seed: string): string {
  const pool = geminiModelPool();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}

function groqKeys(): string[] {
  return splitList(process.env.GROQ_API_KEY, process.env.GROQ_API_KEYS);
}

/** SETTLEMENT_MODELS (comma list): Gemini and Claude ids only, never Gemma or ":free". */
export function settlementModels(): string[] {
  return splitList(process.env.SETTLEMENT_MODELS?.trim() || SETTLEMENT_DEFAULT_MODELS).filter((m) => {
    const l = m.toLowerCase();
    return (l.startsWith("gemini") || l.startsWith("claude")) && !l.includes("gemma") && !l.includes(":free");
  });
}

/** May this model decide a settlement? */
export function isSettlementModel(model: string): boolean {
  return settlementModels().includes(model.trim());
}

/** Gemini models a call tries, preferred first; settlement calls only allowlisted ones. */
function geminiModelsFor(preferred: string | undefined, settlement: boolean): string[] {
  if (!settlement) {
    const pool = geminiModelPool();
    const first = preferred?.trim() || pool[0];
    return [first, ...pool.filter((m) => m !== first)];
  }
  const allowed = settlementModels().filter((m) => m.toLowerCase().startsWith("gemini"));
  const first = preferred && allowed.includes(preferred.trim()) ? preferred.trim() : allowed[0];
  return first ? [first, ...allowed.filter((m) => m !== first)] : [];
}

/** The Claude model a call uses; null when a settlement call may not use one. */
function anthropicModelFor(settlement: boolean): string | null {
  if (!settlement || isSettlementModel(DEFAULT_ANTHROPIC_MODEL)) return DEFAULT_ANTHROPIC_MODEL;
  return settlementModels().find((m) => m.toLowerCase().startsWith("claude")) ?? null;
}

/**
 * The first balanced JSON object/array in chatty model output, ignoring
 * prose and code fences around it and braces inside strings. `prefer` forces
 * the opener ("[" for array prompts).
 */
export function extractJson(text: string, prefer?: "{" | "["): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = prefer ? cleaned.indexOf(prefer) : cleaned.search(/[{[]/);
  if (start === -1) return null;
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return cleaned.slice(start, i + 1);
  }
  return null;
}

function hasKey(provider: LLMProvider, scope: KeyScope): boolean {
  if (provider === "gemini") return geminiKeysFor(scope).length > 0;
  // Groq and OpenRouter keys are shared by definition: never the oracle's.
  if (provider === "groq") return scope.role !== "oracle" && groqKeys().length > 0;
  if (provider === "openrouter") return scope.role !== "oracle" && Boolean(process.env.OPENROUTER_API_KEY?.trim());
  return Boolean(anthropicKeyFor(scope));
}

function cooldown(provider: LLMProvider, scope: KeyScope, geminiModels: string[]): number {
  if (provider === "gemini") {
    const combos = geminiKeysFor(scope).flatMap((k) =>
      geminiModels.map((m) => remaining(geminiCooldownByCombo.get(`${keyId(k)}|${m}`) ?? 0))
    );
    return combos.length === 0 || combos.some((c) => c === 0) ? 0 : Math.min(...combos);
  }
  if (provider === "groq") {
    const keys = groqKeys().map((k) => remaining(groqCooldownByKey.get(k) ?? 0));
    return keys.length === 0 || keys.some((c) => c === 0) ? 0 : Math.min(...keys);
  }
  if (provider === "openrouter") return remaining(openrouterCooldownUntil);
  return 0;
}

export function activeLLMProvider(keyEnv?: string): LLMProvider {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced === "gemini" || forced === "anthropic" || forced === "groq" || forced === "openrouter") return forced;
  if (geminiKeyFor(keyEnv)) return "gemini";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (groqKeys().length > 0) return "groq";
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  throw new Error("No LLM API key configured. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY.");
}

export function activeLLMModel(keyEnv?: string): string {
  return modelFor(activeLLMProvider(keyEnv));
}

function modelFor(provider: LLMProvider, geminiModel?: string): string {
  if (provider === "gemini") return geminiModel ?? DEFAULT_GEMINI_MODEL;
  if (provider === "groq") return DEFAULT_GROQ_MODEL;
  if (provider === "openrouter") return DEFAULT_OPENROUTER_MODEL;
  return DEFAULT_ANTHROPIC_MODEL;
}

/** Redacted id of the active key for startup logs: `sha256:XXXXXXXX`, never key material. */
export function activeLLMKeyFingerprint(keyEnv?: string): string {
  const provider = activeLLMProvider(keyEnv);
  const key = (
    provider === "gemini" ? geminiKeyFor(keyEnv)
    : provider === "groq" ? groqKeys()[0]
    : provider === "openrouter" ? process.env.OPENROUTER_API_KEY
    : process.env.ANTHROPIC_API_KEY
  )?.trim() ?? "";
  return key ? `sha256:${keyId(key)}` : "(missing)";
}

type ChainOpts = Pick<CallLLMOptions, "keyEnv" | "noFreeRouter" | "role" | "settlement" | "mainnet" | "preferFree">;

/**
 * The providers a call tries, primary first, each only when this caller has a
 * key for it. Settlement calls: Gemini and Claude with an allowlisted model
 * only. May be empty.
 */
export function providerChain(opts: ChainOpts = {}): LLMProvider[] {
  const scope = scopeOf(opts);
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  const primary: LLMProvider | undefined =
    forced === "gemini" || forced === "anthropic" || forced === "groq" || forced === "openrouter"
      ? forced
      : (["gemini", "anthropic", "groq", "openrouter"] as const).find((p) => hasKey(p, scope));
  const order: LLMProvider[] =
    opts.preferFree && !opts.settlement
      ? ["groq", "openrouter", "gemini", "anthropic"]
      : [...(primary ? [primary] : []), "groq", "anthropic", "gemini", "openrouter"];
  return order.filter((p, i) => {
    if (order.indexOf(p) !== i || !hasKey(p, scope)) return false;
    if (opts.noFreeRouter && p === "openrouter" && DEFAULT_OPENROUTER_MODEL === "openrouter/free") return false;
    if (opts.settlement) {
      if (p === "gemini") return geminiModelsFor(undefined, true).length > 0;
      if (p === "anthropic") return anthropicModelFor(true) !== null;
      return false;
    }
    return true;
  });
}

interface CallOpts {
  maxTokens: number;
  temperature: number;
  jsonOnly: boolean;
  jsonSchema?: Record<string, unknown>;
  scope: KeyScope;
  geminiModels: string[];
  anthropicModel: string | null;
}

export async function callLLM(prompt: string, opts: CallLLMOptions = {}): Promise<string> {
  return (await callLLMWithMeta(prompt, opts)).text;
}

/** callLLM, plus the provider and model that actually answered. */
export async function callLLMWithMeta(prompt: string, opts: CallLLMOptions = {}): Promise<LLMResult> {
  const settlement = opts.settlement === true;
  const o: CallOpts = {
    maxTokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
    jsonOnly: opts.jsonOnly ?? false,
    jsonSchema: opts.jsonSchema,
    scope: scopeOf(opts),
    geminiModels: geminiModelsFor(opts.model, settlement),
    anthropicModel: anthropicModelFor(settlement),
  };
  const chain = providerChain(opts);
  if (chain.length === 0) {
    throw new Error(
      settlement
        ? "No settlement-grade LLM available (a SETTLEMENT_MODELS model with this caller's own key)"
        : "No LLM API key configured for this caller. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY.",
    );
  }
  let lastError: unknown = null;
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    const next = chain.slice(i + 1).find((q) => cooldown(q, o.scope, o.geminiModels) === 0);
    const wait = cooldown(p, o.scope, o.geminiModels);
    if (wait > 0) {
      lastError = new Error(`LLM quota cooldown (${p}): ${Math.ceil(wait / 1000)}s remaining`);
      continue;
    }
    try {
      const { text, model } =
        p === "gemini" ? await callGemini(prompt, o)
        : p === "groq" ? { text: await callGroq(prompt, o), model: DEFAULT_GROQ_MODEL }
        : p === "openrouter" ? { text: await callOpenRouter(prompt, o), model: DEFAULT_OPENROUTER_MODEL }
        : await callAnthropic(prompt, o);
      lastCall = { provider: p, model };
      return { text, provider: p, model };
    } catch (err) {
      lastError = err;
      if (next) console.warn(`[llm] ${p} failed -> ${next}: ${err instanceof Error ? err.message.slice(0, 90) : err}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All configured LLM providers failed");
}

// ── Gemini ────────────────────────────────────────────────────────────────────
async function callGemini(prompt: string, o: CallOpts): Promise<{ text: string; model: string }> {
  let lastError: unknown = null;
  for (const model of o.geminiModels) {
    for (const key of geminiKeysFor(o.scope)) {
      if (remaining(geminiCooldownByCombo.get(`${keyId(key)}|${model}`) ?? 0) > 0) continue;
      try {
        return { text: await callGeminiModel(key, model, prompt, o), model };
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini: every key/model is cooling down");
}

async function callGeminiModel(apiKey: string, model: string, prompt: string, o: CallOpts): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  // Gemma shares the API but rejects thinkingConfig and responseMimeType.
  const isGemma = model.toLowerCase().startsWith("gemma");
  const generationConfig: Record<string, unknown> = { temperature: o.temperature, maxOutputTokens: o.maxTokens };
  // 2.5+ "thinks" into the output budget by default; off so short JSON is not empty.
  if (!isGemma) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  let text = prompt;
  if (o.jsonOnly) {
    if (isGemma) text = `${prompt}\n\nReturn valid JSON only, with no markdown and no code fences.`;
    else {
      generationConfig.responseMimeType = "application/json";
      if (o.jsonSchema) generationConfig.responseSchema = o.jsonSchema;
    }
  }

  // 429 trips this key×model's cooldown at once; other transient codes back off.
  const TRANSIENT = new Set([408, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 4;
  let res: Response | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) break;
    const body = (await res.text()).slice(0, 500);
    if (res.status === 429) {
      geminiCooldownByCombo.set(`${keyId(apiKey)}|${model}`, Date.now() + GEMINI_QUOTA_COOLDOWN_MS);
      console.warn(`[llm] Gemini ${model}@key:${keyId(apiKey)} 429, ${Math.round(GEMINI_QUOTA_COOLDOWN_MS / 1000)}s cooldown`);
      throw new Error(`Gemini ${model} 429: ${body}`);
    }
    if (!TRANSIENT.has(res.status) || attempt === MAX_ATTEMPTS) throw new Error(`Gemini ${model} ${res.status}: ${body}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
  }

  const json: any = await res!.json();
  const out: string = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("").trim();
  if (!out) {
    const finishReason = json?.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`Gemini ${model} empty response (finishReason=${finishReason})`);
  }
  return out;
}

// ── Groq (OpenAI-compatible) ──────────────────────────────────────────────────
async function callGroq(prompt: string, o: CallOpts): Promise<string> {
  let lastError: Error | null = null;
  for (const apiKey of groqKeys()) {
    if (remaining(groqCooldownByKey.get(apiKey) ?? 0) > 0) continue;
    const body: Record<string, unknown> = {
      model: DEFAULT_GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: o.maxTokens,
      temperature: o.temperature,
    };
    if (o.jsonOnly) body.response_format = { type: "json_object" };
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      const badKey = res.status === 401 || res.status === 403 || (res.status === 400 && /restricted|invalid.?api.?key/i.test(text));
      if (res.status === 429 || badKey) {
        groqCooldownByKey.set(apiKey, Date.now() + GROQ_QUOTA_COOLDOWN_MS);
        lastError = new Error(`Groq key:${keyId(apiKey)} ${res.status}: ${text}`);
        continue;
      }
      throw new Error(`Groq ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    const out: string = (json?.choices?.[0]?.message?.content ?? "").trim();
    if (!out) throw new Error("Groq empty response");
    return out;
  }
  throw lastError ?? new Error("Groq: every key is cooling down");
}

// ── OpenRouter ────────────────────────────────────────────────────────────────
async function callOpenRouter(prompt: string, o: CallOpts): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY!.trim()}`,
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || "Mimir",
  };
  if (process.env.OPENROUTER_SITE_URL?.trim()) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL.trim();
  const body: Record<string, unknown> = {
    model: DEFAULT_OPENROUTER_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: o.maxTokens,
    temperature: o.temperature,
  };
  if (o.jsonOnly && DEFAULT_OPENROUTER_MODEL !== "openrouter/free") body.response_format = { type: "json_object" };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    if (res.status === 429) openrouterCooldownUntil = Date.now() + OPENROUTER_QUOTA_COOLDOWN_MS;
    throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json: any = await res.json();
  const out: string = (json?.choices?.[0]?.message?.content ?? "").trim();
  if (!out) throw new Error("OpenRouter empty response");
  return out;
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
async function callAnthropic(prompt: string, o: CallOpts): Promise<{ text: string; model: string }> {
  const apiKey = anthropicKeyFor(o.scope);
  const model = o.anthropicModel;
  if (!apiKey || !model) throw new Error("Anthropic: no key or allowed model for this caller");
  let client = anthropicClients.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey, timeout: 60_000 });
    anthropicClients.set(apiKey, client);
  }
  const message = await client.messages.create({
    model,
    max_tokens: o.maxTokens,
    temperature: o.temperature,
    messages: [{ role: "user", content: prompt }],
  });
  return { text: (message.content[0] as { text?: string }).text ?? "", model };
}
