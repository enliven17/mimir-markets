/**
 * Bridges the /api/arena claim shape (base units as strings) to the pure V3
 * lifecycle helpers in lib/solana/lifecycle.ts, so the claim page applies the
 * same timing rules as the program and the oracle.
 */
import type { LifecycleClaim } from "./solana/lifecycle";

export interface ArenaLifecycleFields {
  state: number;
  winnerSide: number;
  deadline: number;
  creatorStake: string;
  totalChallengerStake: string;
  creatorPaid?: boolean;
  challengers: { stake: string; paid: boolean }[];
  resolutionGrace?: number;
  disputableUntil?: number;
  disputedAt?: number;
  bondState?: number;
}

/** Seven days, the program's default grace, for rows indexed before V3 fields existed. */
const DEFAULT_GRACE = 7 * 24 * 3600;

export function toLifecycle(c: ArenaLifecycleFields): LifecycleClaim {
  return {
    state: c.state,
    winnerSide: c.winnerSide,
    deadline: c.deadline,
    creatorStake: BigInt(c.creatorStake || "0"),
    totalChallengerStake: BigInt(c.totalChallengerStake || "0"),
    creatorPaid: Boolean(c.creatorPaid),
    challengers: c.challengers.map((ch) => ({ stake: BigInt(ch.stake || "0"), paid: ch.paid })),
    resolutionGrace: c.resolutionGrace && c.resolutionGrace > 0 ? c.resolutionGrace : DEFAULT_GRACE,
    disputableUntil: c.disputableUntil ?? 0,
    disputedAt: c.disputedAt ?? 0,
    bondState: c.bondState ?? 0,
  };
}
