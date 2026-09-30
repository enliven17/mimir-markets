/**
 * Shared types for the Mimir Council runtime (agents/council/shared/*).
 */
import type { OnchainClaim } from "../../../lib/solana/client";
import type { Verdict } from "../../../lib/verdict";

/** The claim fields the council reads. An OnchainClaim satisfies it. */
export type CouncilClaim = Pick<
  OnchainClaim,
  | "id"
  | "creator"
  | "question"
  | "creatorPosition"
  | "counterPosition"
  | "resolutionUrl"
  | "category"
  | "creatorStake"
  | "totalChallengerStake"
  | "deadline"
  | "state"
  | "maxChallengers"
  | "challengers"
>;

export type SkipReason =
  | "category-filter"
  | "abstain-low-confidence"
  | "abstain-agrees-with-creator"
  | "no-pool-imbalance"
  | "no-whale-yet"
  | "no-evidence"
  | "llm-failed";

/**
 * What a persona decides about one claim in one cycle.
 *
 * Personas can only join the challenger side (claim creation is the
 * market-creator's role). A persona that agrees with the creator abstains.
 */
export interface PersonaDecision {
  shouldStake: boolean;
  /** Base stake in USDC from the spec; the runner sizes the real stake. */
  stakeUsdc: number;
  /** Human-readable reason: logged, and shown by /api/council/reasoning. */
  rationale: string;
  /** LLM confidence (0-100). Rule personas have none. */
  confidence?: number;
  /** Full LLM verdict, when one was made (logged for /calibration). */
  verdict?: Verdict;
  skipReason?: SkipReason;
}

export interface EvidenceCacheEntry {
  text: string;
  /** Fetcher that produced the text, or "none" when nothing usable came back. */
  fetcher: string;
}
