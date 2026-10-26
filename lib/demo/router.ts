import type { JsonRouter } from "../launch/engine/rank";

/** Exactly one bounded provider request per reserved credit. No retries, fallback keys or oracle credentials. */
export function demoRouter(reserve: () => Promise<boolean>, fetcher: typeof fetch = fetch, pinnedModel?: string): JsonRouter {
  return {
    async completeJson(o, parse) {
      const key = process.env.DEMO_GEMINI_API_KEY?.trim();
      const model = pinnedModel ?? (process.env.DEMO_GEMINI_MODEL?.trim() || "gemini-2.5-flash");
      if (!key || !/^[a-zA-Z0-9.-]+$/.test(model)) throw new Error("Preview AI is unavailable.");
      if (!await reserve()) throw new Error("Preview AI allowance reached; waiting for the next window.");
      const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${o.system}\n\n${o.user}` }] }],
          generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 }, temperature: 0, maxOutputTokens: Math.min(1024, o.maxTokens ?? 1024) } }),
      });
      if (!response.ok) throw new Error(`Preview AI unavailable (${response.status}).`);
      const result = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = (result.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      return { data: parse(JSON.parse(text)), provider: "gemini", model };
    },
  };
}
