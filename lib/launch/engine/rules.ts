// Entry rules, enforced in code. Fail closed: an unknown metric, a missing/NaN value, an unknown
// operator or an empty rule set never lets a candidate through. The LLM only sees what passes here.
import { METRICS } from "../types";
import type { Condition } from "../types";
import type { Candidate } from "../ports";

export type RuleResult = { ok: boolean; failed: string[] };

const isMetric = (m: unknown): m is Condition["metric"] => typeof m === "string" && Object.hasOwn(METRICS, m);

/** Why one condition fails, or null when it holds. */
export function conditionFailure(candidate: Candidate, c: Condition): string | null {
  if (!c || !isMetric(c.metric)) return `unknown metric ${String(c?.metric)}`;
  if (c.op !== ">" && c.op !== "<") return `unknown operator ${String(c.op)} on ${c.metric}`;
  if (typeof c.value !== "number" || !Number.isFinite(c.value)) return `bad threshold on ${c.metric}`;
  const v = candidate.metrics?.[c.metric];
  if (typeof v !== "number" || !Number.isFinite(v)) return `${c.metric} unknown`;
  const ok = c.op === ">" ? v > c.value : v < c.value;
  return ok ? null : `${c.metric} ${round(v)} not ${c.op} ${c.value}`;
}

export function checkRules(candidate: Candidate, conditions: readonly Condition[]): RuleResult {
  if (!Array.isArray(conditions) || conditions.length === 0) return { ok: false, failed: ["no entry rules set"] };
  const failed = conditions.map((c) => conditionFailure(candidate, c)).filter((f): f is string => f !== null);
  return { ok: failed.length === 0, failed };
}

export const passes = (candidate: Candidate, conditions: readonly Condition[]): boolean => checkRules(candidate, conditions).ok;

export const passingCandidates = (candidates: readonly Candidate[], conditions: readonly Condition[]): Candidate[] =>
  candidates.filter((c) => passes(c, conditions));

function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
}
