/**
 * Mimir Launch: the agent's brain on Mimir's own LLM keys (lib/llm.ts). The engine's ranker (engine/rank.ts) and the
 * market judge (markets.ts) take a JsonRouter; this is the platform one. An owner's own key is a second router
 * (byok.ts) with the same shape. Agents spend the "web" role, so they never touch the oracle's settlement keys.
 */
import { callLLMWithMeta, extractJson } from "@/lib/llm";
import type { JsonRouter } from "./engine/rank";

/** Agents' own Gemini key when one is set (LAUNCH_GEMINI_API_KEY), else the shared pool. */
export const LAUNCH_KEY_ENV = "LAUNCH_GEMINI_API_KEY";

export const platformRouter: JsonRouter = {
  async completeJson(o, parse) {
    const prompt = `${o.system}\n\n${o.user}`;
    const res = await callLLMWithMeta(prompt, {
      jsonOnly: o.json ?? true,
      maxTokens: o.maxTokens ?? 1024,
      temperature: o.temperature ?? 0,
      role: "web",
      keyEnv: LAUNCH_KEY_ENV,
    });
    const json = extractJson(res.text);
    if (!json) throw new Error(`launch llm: no JSON in the reply (${res.provider}/${res.model})`);
    return { data: parse(JSON.parse(json)), provider: res.provider, model: res.model };
  },
};
