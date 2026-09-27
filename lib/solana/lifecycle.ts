/**
 * Pure helpers over the V3 claim lifecycle (no RPC), shared by the oracle
 * worker, the indexer and UI code. Timing rules mirror the program exactly
 * (onchain/programs/mimir/src/instructions/resolution.rs).
 */
import {
  BOND_REFUND_DUE,
  ST_ACTIVE,
  ST_DISPUTED,
  ST_OPEN,
  ST_PROPOSED,
  ST_RESOLVED,
} from "./config";
import { challengerGross, creatorGross } from "./fees";

export interface LifecycleClaim {
  state: number;
  winnerSide: number;
  deadline: number;
  creatorStake: bigint;
  totalChallengerStake: bigint;
  creatorPaid: boolean;
  challengers: { stake: bigint; paid: boolean }[];
  resolutionGrace: number;
  disputableUntil: number;
  disputedAt: number;
  bondState: number;
}

/** When refund_expired becomes callable (grace counts from the dispute if there was one). */
export function refundableAt(c: Pick<LifecycleClaim, "state" | "deadline" | "disputedAt" | "resolutionGrace">): number {
  const disputed = c.state === ST_DISPUTED;
  const start = disputed && c.disputedAt > c.deadline ? c.disputedAt : c.deadline;
  return start + c.resolutionGrace;
}

export function canRefundExpired(c: LifecycleClaim, now: number): boolean {
  const eligible = c.state === ST_OPEN || c.state === ST_ACTIVE || c.state === ST_DISPUTED;
  return eligible && now >= refundableAt(c);
}

export function canFinalize(c: LifecycleClaim, now: number): boolean {
  return c.state === ST_PROPOSED && now >= c.disputableUntil;
}

export function isDisputable(c: LifecycleClaim, now: number): boolean {
  return c.state === ST_PROPOSED && now < c.disputableUntil;
}

/** Oracle should propose: ACTIVE and past the deadline. */
export function needsProposal(c: LifecycleClaim, now: number): boolean {
  return c.state === ST_ACTIVE && c.deadline <= now;
}

/** Payout legs (and a returned bond) still waiting for a crank on a RESOLVED claim. */
export function unpaidLegs(c: LifecycleClaim): number {
  if (c.state !== ST_RESOLVED) return 0;
  let n = 0;
  if (!c.creatorPaid && creatorGross(c.winnerSide, c.creatorStake, c.totalChallengerStake)) n++;
  for (const ch of c.challengers) {
    if (!ch.paid && challengerGross(c.winnerSide, ch.stake, c.creatorStake, c.totalChallengerStake)) n++;
  }
  if (c.bondState === BOND_REFUND_DUE) n++;
  return n;
}
