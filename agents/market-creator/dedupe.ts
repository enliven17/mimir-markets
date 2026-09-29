/**
 * Duplicate guard for drafts: against the claims still joinable on chain and
 * within one run.
 *
 * Two drafts collide on the same category plus either the same question (after
 * normalising filler words and accents) or the same resolution source. The
 * source key drops only the URL fragment (the resolver spec rides there) and
 * keeps the query: a Polymarket record is `?slug=…` and an ESPN game is
 * `?dates=…&event=…`, so the query is what tells two markets apart.
 */
import { stripResolverFragment } from "../../lib/resolver-spec";

export interface ClaimSignature {
  category: string;
  questionKey: string;
  sourceKey: string;
  /** For logs: `#<id>` of an on-chain claim, or the draft label. */
  label: string;
}

export function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(will|does|do|did|the|their|a|an|in|on|at|by|before|after|during)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSourceKey(value: string): string {
  const raw = stripResolverFragment(value.trim());
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.replace(/^www\./, "");
    return url.toString().replace(/\/(?=$|\?)/, "").toLowerCase();
  } catch {
    return raw.replace(/\/$/, "").toLowerCase();
  }
}

export function signatureOf(c: { category: string; question: string; resolutionUrl: string }, label: string): ClaimSignature {
  return {
    category: c.category.toLowerCase().trim(),
    questionKey: normalizeComparableText(c.question),
    sourceKey: normalizeSourceKey(c.resolutionUrl),
    label,
  };
}

/**
 * Drop drafts that repeat a joinable claim or an earlier draft in the list.
 * `onDrop` gets a reason for logging. Pure: the input is not modified.
 */
export function filterDuplicates<T extends { category: string; question: string; resolutionUrl: string; label: string }>(
  drafts: T[],
  existing: ClaimSignature[],
  onDrop: (draft: T, reason: string) => void = () => {},
): T[] {
  const questions = new Map<string, string>();
  const sources = new Map<string, string>();
  for (const s of existing) {
    if (s.questionKey) questions.set(`${s.category}:${s.questionKey}`, s.label);
    if (s.sourceKey) sources.set(`${s.category}:${s.sourceKey}`, s.label);
  }

  const kept: T[] = [];
  for (const d of drafts) {
    const sig = signatureOf(d, d.label);
    const qKey = `${sig.category}:${sig.questionKey}`;
    const sKey = `${sig.category}:${sig.sourceKey}`;
    const sameSource = sig.sourceKey ? sources.get(sKey) : undefined;
    const sameQuestion = sig.questionKey ? questions.get(qKey) : undefined;
    if (sameSource !== undefined || sameQuestion !== undefined) {
      onDrop(d, sameSource !== undefined ? `same source as ${sameSource}` : `same question as ${sameQuestion}`);
      continue;
    }
    if (sig.sourceKey) sources.set(sKey, `draft "${d.label}"`);
    if (sig.questionKey) questions.set(qKey, `draft "${d.label}"`);
    kept.push(d);
  }
  return kept;
}
