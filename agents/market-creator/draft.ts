/**
 * The shape every market-creator source drafts into, the program's string
 * limits, and the decidability gate a draft must pass before it is staked on.
 *
 * The Claim account has no settlement-rule field (question, positions, URL and
 * category are all the oracle reads), so `settlementRule` here is only used to
 * score the draft and to brief the council preflight; the question itself must
 * carry the condition.
 */
import { computeClaimQuality, type ClaimQualityResult } from "../../lib/claimQuality";

export type DraftSource = "flash" | "espn" | "stocks" | "polymarket" | "ansem";

export interface DraftClaim {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  category: string;
  resolutionUrl: string;
  /** Scoring + preflight only; never written on chain. */
  settlementRule: string;
  /** Unix seconds, always an integer (the program stores an i64). */
  deadline: number;
  source: DraftSource;
  /** Short log label. */
  label: string;
}

// onchain/programs/mimir/src/constants.rs (bytes, Borsh strings).
export const MAX_QUESTION_BYTES = 200;
export const MAX_POSITION_BYTES = 100;
export const MAX_URL_BYTES = 200;
export const MAX_CATEGORY_BYTES = 32;

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/**
 * Floor to whole seconds. Kickoff- and market-pinned deadlines come out
 * fractional, and BN/BigInt reject non-integers (the source's d9fa973 bug).
 */
export function toDeadline(ms: number): number {
  return Math.floor(ms / 1000);
}

/** Why a draft cannot go on chain as-is, or null. */
export function draftProblem(d: DraftClaim, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (!d.question.trim() || !d.creatorPosition.trim() || !d.counterPosition.trim()) return "empty field";
  if (bytes(d.question) > MAX_QUESTION_BYTES) return `question over ${MAX_QUESTION_BYTES} bytes`;
  if (bytes(d.creatorPosition) > MAX_POSITION_BYTES || bytes(d.counterPosition) > MAX_POSITION_BYTES) {
    return `position over ${MAX_POSITION_BYTES} bytes`;
  }
  if (bytes(d.resolutionUrl) > MAX_URL_BYTES) return `url over ${MAX_URL_BYTES} bytes`;
  if (bytes(d.category) > MAX_CATEGORY_BYTES) return `category over ${MAX_CATEGORY_BYTES} bytes`;
  if (!Number.isInteger(d.deadline)) return "deadline is not whole seconds";
  if (d.deadline <= nowSec + 60) return "deadline too close";
  return null;
}

export function scoreDraft(d: DraftClaim, nowSec = Math.floor(Date.now() / 1000)): ClaimQualityResult {
  return computeClaimQuality(
    {
      question: d.question,
      creator_position: d.creatorPosition,
      opponent_position: d.counterPosition,
      resolution_url: d.resolutionUrl,
      settlement_rule: d.settlementRule,
      category: d.category,
      deadline: d.deadline,
    },
    nowSec,
  );
}

/** Trim to a byte budget on a character boundary (names with accents are multi-byte). */
export function clampBytes(s: string, max: number): string {
  if (bytes(s) <= max) return s;
  const budget = max - bytes("…");
  let out = "";
  for (const ch of s) {
    if (bytes(out + ch) > budget) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
