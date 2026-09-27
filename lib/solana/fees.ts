/**
 * Fee arithmetic, mirroring the Mimir program exactly
 * (onchain/programs/mimir/src/math.rs, itself a port of MimirV3 `_payWinner`).
 *
 * The UI quotes a split before you stake, and an agent's dry run needs the
 * same numbers the program will produce. Any divergence is a bug here.
 * Amounts are USDC base units (6 decimals) as bigint.
 */

export const BPS_DENOMINATOR = 10_000n;

/** No policy may take more than 10% of a winner's profit, in total. */
export const MAX_TOTAL_FEE_BPS = 1_000;

export interface FeePolicy {
  /** Charged on profit, accrued to the platform fee pool. */
  platformFeeBps: number;
  /** Charged on profit, accrued to the owner of the agent that opened the position. */
  agentOwnerFeeBps: number;
  /** Base58 platform recipient; null/empty = no platform fee. */
  platformRecipient: string | null;
}

/** What the devnet program was initialized with (mirrors MimirV3 defaults). */
export const DEFAULT_FEE_POLICY: FeePolicy = {
  platformFeeBps: 50,
  agentOwnerFeeBps: 50,
  platformRecipient: null,
};

export class InvalidFeePolicyError extends Error {}

export function validateFeePolicy(policy: FeePolicy): void {
  const { platformFeeBps, agentOwnerFeeBps, platformRecipient } = policy;
  for (const [name, bps] of [
    ["platformFeeBps", platformFeeBps],
    ["agentOwnerFeeBps", agentOwnerFeeBps],
  ] as const) {
    if (!Number.isInteger(bps) || bps < 0 || bps > 0xffff) {
      throw new InvalidFeePolicyError(`${name} must be a u16 integer`);
    }
  }
  if (platformFeeBps + agentOwnerFeeBps > MAX_TOTAL_FEE_BPS) {
    throw new InvalidFeePolicyError(
      `total fee ${platformFeeBps + agentOwnerFeeBps} bps exceeds the ${MAX_TOTAL_FEE_BPS} bps cap`
    );
  }
  if (platformFeeBps > 0 && !platformRecipient) {
    throw new InvalidFeePolicyError("a platform fee needs a recipient");
  }
}

export interface FeeSplitInput {
  /** Everything the winner would receive before fees. */
  gross: bigint;
  /** What the winner staked. Fees never touch this. */
  principal: bigint;
  policy: FeePolicy;
  /** Base58 of who is being paid. Used to waive a leg they would pay to themselves. */
  winner: string;
  /** Base58 owner of the agent this position ran through, if any. */
  agentOwner?: string | null;
}

export interface FeeSplit {
  profit: bigint;
  platformFee: bigint;
  agentOwnerFee: bigint;
  totalFees: bigint;
  /** What actually lands in the winner's token account. */
  netPayout: bigint;
}

/** The all-ones system key the program treats as "no recipient". */
const NONE = "11111111111111111111111111111111";
const present = (k: string | null | undefined): k is string => Boolean(k && k !== NONE);

/**
 * Fees on profit only: `gross - principal` floored at zero, so refunds and
 * break-even wins are free. Division rounds down (remainder stays with the
 * participant). A recipient who is also the winner waives that leg. Base58
 * is case-sensitive, so keys compare exactly.
 */
export function splitFees({ gross, principal, policy, winner, agentOwner }: FeeSplitInput): FeeSplit {
  validateFeePolicy(policy);
  const profit = gross > principal ? gross - principal : 0n;
  let platformFee = 0n;
  let agentOwnerFee = 0n;
  if (profit > 0n) {
    if (policy.platformFeeBps > 0 && present(policy.platformRecipient) && policy.platformRecipient !== winner) {
      platformFee = (profit * BigInt(policy.platformFeeBps)) / BPS_DENOMINATOR;
    }
    if (policy.agentOwnerFeeBps > 0 && present(agentOwner) && agentOwner !== winner) {
      agentOwnerFee = (profit * BigInt(policy.agentOwnerFeeBps)) / BPS_DENOMINATOR;
    }
  }
  const totalFees = platformFee + agentOwnerFee;
  return { profit, platformFee, agentOwnerFee, totalFees, netPayout: gross - totalFees };
}

/** Gross + principal for the creator's leg, or null when the creator is owed nothing. */
export function creatorGross(
  winnerSide: number,
  creatorStake: bigint,
  totalChallengerStake: bigint
): { gross: bigint; principal: bigint } | null {
  if (winnerSide === 1) return { gross: creatorStake + totalChallengerStake, principal: creatorStake };
  if (winnerSide === 3 || winnerSide === 4) return { gross: creatorStake, principal: creatorStake };
  return null;
}

/** Pool odds: stake + proportional share of the creator stake (rounded down). */
export function challengerGross(
  winnerSide: number,
  stake: bigint,
  creatorStake: bigint,
  totalChallengerStake: bigint
): { gross: bigint; principal: bigint } | null {
  if (winnerSide === 2) {
    if (totalChallengerStake === 0n) return null;
    return { gross: stake + (stake * creatorStake) / totalChallengerStake, principal: stake };
  }
  if (winnerSide === 3 || winnerSide === 4) return { gross: stake, principal: stake };
  return null;
}

/** Being right must never cost money. */
export function noWinnerLosesPrincipal(split: FeeSplit, principal: bigint): boolean {
  return split.netPayout >= principal;
}

/** Nothing is created or destroyed: net payout plus fees equals the gross. */
export function conservationHolds(split: FeeSplit, gross: bigint): boolean {
  return split.netPayout + split.totalFees === gross;
}
