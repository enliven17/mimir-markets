/**
 * Mimir market codes, chain-neutral: states and sides (MimirV3 / MimirPool numbering, mirrored by the oracle, the
 * council and the UI), dispute bond states, and USDC unit helpers (6 dp). Pure, isomorphic.
 */
export const USDC_DECIMALS = 6;

/** Convert a UI amount (e.g. 2.5) to base units (6 dp) */
export function toUsdcUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}

export function fromUsdcUnits(units: bigint | number): number {
  return Number(units) / 10 ** USDC_DECIMALS;
}

// ── Market states (MimirV3 numbering) ───────────────────────────────────────

export const ST_OPEN = 0;
export const ST_ACTIVE = 1;
export const ST_RESOLVED = 2;
export const ST_CANCELLED = 3;
/** Oracle proposed a verdict; disputable until `disputableUntil`. */
export const ST_PROPOSED = 4;
/** A participant posted a bond to dispute; the admin (arbiter) decides. */
export const ST_DISPUTED = 5;

export const STATE_LABELS = ["OPEN", "ACTIVE", "RESOLVED", "CANCELLED", "PROPOSED", "DISPUTED"] as const;

/** Claim still takes (or holds) positions: not proposed, settled or cancelled. */
export function isLiveState(state: number): boolean {
  return state === ST_OPEN || state === ST_ACTIVE;
}

/** A verdict is in, final or not (PROPOSED / DISPUTED / RESOLVED). */
export function isSettlingState(state: number): boolean {
  return state === ST_PROPOSED || state === ST_DISPUTED || state === ST_RESOLVED;
}

export const SIDE_NONE = 0;
export const SIDE_CREATOR = 1;
export const SIDE_CHALLENGERS = 2;
export const SIDE_DRAW = 3;
export const SIDE_UNRESOLVABLE = 4;

// Dispute bond lifecycle
export const BOND_NONE = 0;
export const BOND_HELD = 1;
export const BOND_REFUND_DUE = 2;
export const BOND_REFUNDED = 3;
export const BOND_FORFEITED = 4;

/** Bond a participant posts to dispute a proposal. */
export const DISPUTE_BOND_UNITS = 2_000_000n;
/** Minimum stake, 2 USDC. */
export const MIN_STAKE_UNITS = 2_000_000n;
/** No fee policy may take more than 10% of a winner's profit. */
export const MAX_TOTAL_FEE_BPS = 1_000;
