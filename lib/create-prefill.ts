/**
 * Prefill for /arena/create from a challenge-opportunity card (or any link):
 *   /arena/create?source=<url>&q=<question>&a=<side A>&b=<side B>
 *                &cat=<category>&deadline=<ISO>&rule=<settlement rule>
 *
 * Everything is optional except `source`. Values are untrusted query input:
 * each is trimmed, length-capped to the on-chain limits and dropped when
 * malformed, so a bad link degrades to an empty field, never a broken form.
 */
import type { SourceClaimDraftCandidate } from "./claimDrafts";
import { normalizeCategoryId, type CategoryId } from "./constants";

/** Mirrors the #[max_len] on the Claim account. */
export const PREFILL_LIMITS = { question: 200, position: 100, url: 200, rule: 600 } as const;

export interface CreatePrefill {
  source: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  category: CategoryId | null;
  /** Unix seconds, only when in the future. */
  deadline: number | null;
  settlementRule: string;
}

function clean(value: string | null, max: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? "" : text;
}

function cleanUrl(value: string | null): string {
  const text = clean(value, PREFILL_LIMITS.url);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? text : "";
  } catch {
    return "";
  }
}

/** Parse the prefill query; null when there is nothing usable to fill. */
export function parseCreatePrefill(params: URLSearchParams, nowSec = Math.floor(Date.now() / 1000)): CreatePrefill | null {
  const deadlineMs = Date.parse(params.get("deadline") ?? "");
  const deadline = Number.isFinite(deadlineMs) && deadlineMs / 1000 > nowSec ? Math.floor(deadlineMs / 1000) : null;
  const rawCategory = clean(params.get("cat"), 32);
  const prefill: CreatePrefill = {
    source: cleanUrl(params.get("source")),
    question: clean(params.get("q"), PREFILL_LIMITS.question),
    creatorPosition: clean(params.get("a"), PREFILL_LIMITS.position),
    counterPosition: clean(params.get("b"), PREFILL_LIMITS.position),
    category: rawCategory ? normalizeCategoryId(rawCategory) : null,
    deadline,
    settlementRule: clean(params.get("rule"), PREFILL_LIMITS.rule),
  };
  return prefill.source || prefill.question ? prefill : null;
}

/** The create-page link for a drafted candidate. */
export function createPrefillHref(candidate: SourceClaimDraftCandidate): string {
  const q = new URLSearchParams({ source: candidate.primaryResolutionSource });
  if (candidate.claimText) q.set("q", candidate.claimText);
  if (candidate.sideA) q.set("a", candidate.sideA);
  if (candidate.sideB) q.set("b", candidate.sideB);
  if (candidate.category) q.set("cat", candidate.category);
  if (candidate.deadlineAt) q.set("deadline", candidate.deadlineAt);
  if (candidate.settlementRule) q.set("rule", candidate.settlementRule.slice(0, PREFILL_LIMITS.rule));
  return `/arena/create?${q.toString()}`;
}
