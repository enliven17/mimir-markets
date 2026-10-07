/**
 * TypeSafe AI's Jev: a "system one" model that answers typed questions (yes/no, one of a list, a point on a scale)
 * with calibrated probabilities in ~100 ms, instead of writing text. Mimir uses it as the cheap first step of a
 * cascade: decide the clear cases in code, call a full model only for the rest.
 *
 * Dormant without TYPESAFE_API_KEY: ask() returns null without a network call, and every caller falls back to the
 * path it had before. It never throws: a timeout, a 4xx/5xx or a malformed reply is null too.
 *
 * Never used for settlement verdicts: those need written, audited reasoning (agents/oracle), which Jev does not give.
 *
 * API: POST https://api.typesafe.ai/v1/systemone { model, state, questions } → { model, answers, usage }.
 */

export type JevQuestion =
  /** Yes/no: the answer is the probability of yes. */
  | { type: "noul"; instructions: string }
  /** One of the labelled options (up to 255): label → what it means. */
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  /** A position on an ordered scale of 2-10 levels. */
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer<Q extends JevQuestion> = Q extends { type: "noul" }
  ? { noul: number }
  : Q extends { type: "choice"; criteria: infer C }
    ? { choice: Extract<keyof C, string>; probabilities: Record<string, number>; confidence: number }
    : { score: number; probabilities: number[]; confidence: number };

export type JevAnswers<Qs extends Record<string, JevQuestion>> = { [K in keyof Qs]: JevAnswer<Qs[K]> };

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const RETRY_STATUS = new Set([429, 529]);

const key = () => process.env.TYPESAFE_API_KEY?.trim() ?? "";

/** True when a key is configured; without one Jev is off and costs nothing. */
export const jevEnabled = (): boolean => key().length > 0;

const isProb = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;

/** One answer checked against its question; null when the reply does not fit it. */
function parseAnswer(q: JevQuestion, raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (q.type === "noul") return isProb(a.noul) ? { noul: a.noul } : null;
  if (q.type === "choice") {
    if (typeof a.choice !== "string" || !(a.choice in q.criteria)) return null;
    const probabilities = a.probabilities && typeof a.probabilities === "object" ? (a.probabilities as Record<string, number>) : {};
    return { choice: a.choice, probabilities, confidence: isProb(a.confidence) ? a.confidence : 0 };
  }
  if (typeof a.score !== "number" || !Number.isFinite(a.score)) return null;
  return { score: a.score, probabilities: Array.isArray(a.probabilities) ? (a.probabilities as number[]) : [], confidence: isProb(a.confidence) ? a.confidence : 0 };
}

/**
 * Ask Jev typed questions about `state`. Null when Jev is off, slow (timeoutMs, default 2 s), refuses, or answers
 * anything that does not fit the questions. Retries once on 429/529.
 */
export async function ask<Qs extends Record<string, JevQuestion>>(
  state: string | Record<string, unknown>,
  questions: Qs,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<JevAnswers<Qs> | null> {
  const apiKey = key();
  if (!apiKey) return null;
  const doFetch = opts.fetchImpl ?? fetch;
  const body = JSON.stringify({ model: process.env.JEV_MODEL?.trim() || "jev-latest", state, questions });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await doFetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 2_000),
      });
      if (RETRY_STATUS.has(res.status) && attempt === 0) continue;
      if (!res.ok) {
        console.warn(`[jev] ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { answers?: Record<string, unknown> };
      const out: Record<string, unknown> = {};
      for (const [id, q] of Object.entries(questions)) {
        const parsed = parseAnswer(q, json.answers?.[id]);
        if (!parsed) return null;
        out[id] = parsed;
      }
      return out as JevAnswers<Qs>;
    } catch (err) {
      console.warn("[jev] request failed:", err instanceof Error ? err.name : "error");
      return null;
    }
  }
  return null;
}
