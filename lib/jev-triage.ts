/**
 * Market triage with Jev (lib/jev.ts): three typed reads of a newly opened market, stored by the backend
 * (convex/arcTriage.ts). The council skips a take on a market Jev is sure is spam or cannot be settled, which
 * saves the model call; nothing else acts on it. Without a Jev key there is no triage and nothing changes.
 */
import { CATEGORIES } from "./constants";
import { ask, type JevQuestion } from "./jev";

/** Skip the council take when Jev puts spam at or above this… */
export const SPAM_SKIP_AT = 0.85;
/** …or puts "can be settled" at or below this. */
export const RESOLVABLE_SKIP_AT = 0.15;

export interface TriageMarket {
  question: string;
  labelA: string;
  labelB: string;
  resolutionUrl: string;
  category: string;
  deadline: number;
}

export interface Triage {
  resolvable: number;
  spam: number;
  category: string;
  categoryConfidence: number;
}

const QUESTIONS = {
  resolvable: {
    type: "noul",
    instructions:
      "Can this market be settled objectively from its named source at its deadline: a clear question, two sides that cover the outcome, and a source that will show the answer?",
  },
  spam: {
    type: "noul",
    instructions: "Is this market spam: nonsense, a test, gibberish, abusive, or not a real question about the world?",
  },
  category: {
    type: "choice",
    instructions: "Which category does this market belong to?",
    criteria: Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<(typeof CATEGORIES)[number]["id"], string>,
  },
} satisfies Record<string, JevQuestion>;

/** The market as Jev reads it: text only, every field labelled. */
export function triageState(m: TriageMarket): string {
  return [
    `Question: ${m.question}`,
    `Side A: ${m.labelA}`,
    `Side B: ${m.labelB}`,
    `Resolution source: ${m.resolutionUrl}`,
    `Category given by the creator: ${m.category}`,
    `Deadline (UTC): ${new Date(m.deadline * 1000).toISOString()}`,
  ].join("\n");
}

/** Null when Jev is off or did not answer. */
export async function triageMarket(m: TriageMarket, opts: { fetchImpl?: typeof fetch } = {}): Promise<Triage | null> {
  const a = await ask(triageState(m), QUESTIONS, opts);
  if (!a) return null;
  return { resolvable: a.resolvable.noul, spam: a.spam.noul, category: a.category.choice, categoryConfidence: a.category.confidence };
}

/** True when the council should not spend a model call on this market. */
export const skipTake = (t: Pick<Triage, "spam" | "resolvable"> | null | undefined): boolean =>
  !!t && (t.spam >= SPAM_SKIP_AT || t.resolvable <= RESOLVABLE_SKIP_AT);
