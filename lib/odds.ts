/**
 * What the money on a claim implies about the outcome.
 *
 * A prediction market card that shows only a question and a pot is a headline,
 * not a market. The number a reader actually wants is where the crowd is, and
 * on a funded claim that is already on chain: it is the split of the stakes.
 *
 * Mimir on Solana is pari-mutuel (see `payout_challenger` in the program): a
 * winning challenger gets their stake back plus a pro-rata share of the
 * creator stake. Money piling onto one side lowers that side's payout, which
 * is the crowd saying it is the likelier outcome, so the implied probability of
 * a side is its share of the total pot.
 */

import { unitsToUsdc } from "./money";

/** Anything carrying the two on-chain stake totals, in base units or USDC. */
export interface StakeSplit {
  /** Base units (bigint / numeric string) unless `inUsdc` is set. */
  creatorStake: bigint | string | number;
  totalChallengerStake: bigint | string | number;
}

export interface ImpliedOdds {
  /** USDC. */
  creatorStake: number;
  challengerStake: number;
  totalPot: number;
  /** 0 to 1. Null when nothing has been staked against the creator yet. */
  creatorProbability: number | null;
  challengerProbability: number | null;
  /** Gross return per unit staked, for a challenger joining now. */
  challengerPayoutMultiple: number | null;
  /** True when no counter-stake exists, so there is no price yet. */
  unpriced: boolean;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function impliedOdds(split: StakeSplit, opts: { inUsdc?: boolean } = {}): ImpliedOdds {
  const toUsdc = (v: bigint | string | number) => (opts.inUsdc ? Number(v) : unitsToUsdc(v));
  const creatorStake = positive(toUsdc(split.creatorStake));
  const challengerStake = positive(toUsdc(split.totalChallengerStake));
  const totalPot = creatorStake + challengerStake;

  if (challengerStake === 0 || totalPot === 0) {
    return {
      creatorStake,
      challengerStake,
      totalPot,
      creatorProbability: null,
      challengerProbability: null,
      challengerPayoutMultiple: null,
      unpriced: true,
    };
  }

  const challengerProbability = challengerStake / totalPot;
  return {
    creatorStake,
    challengerStake,
    totalPot,
    challengerProbability,
    creatorProbability: 1 - challengerProbability,
    // A challenger's share of the creator stake, plus their own back.
    challengerPayoutMultiple: 1 + creatorStake / challengerStake,
    unpriced: false,
  };
}

/** Percentage for display. Null probabilities render as a dash, not as zero. */
export function formatProbability(probability: number | null): string {
  if (probability === null || !Number.isFinite(probability)) return "—";
  return `${Math.round(probability * 100)}%`;
}

/**
 * Bar widths that always sum to 100 and never collapse a funded side to
 * nothing: a 1% side still needs to be visible as a sliver.
 */
export function oddsBarWidths(odds: ImpliedOdds): { creator: number; challenger: number } {
  if (odds.creatorProbability === null || odds.challengerProbability === null) {
    return { creator: 100, challenger: 0 };
  }
  const MIN_VISIBLE = 4;
  let creator = Math.round(odds.creatorProbability * 100);
  creator = Math.min(100 - MIN_VISIBLE, Math.max(MIN_VISIBLE, creator));
  return { creator, challenger: 100 - creator };
}

/**
 * How lopsided the book is, 0 (even) to 1 (one-sided).
 *
 * Used to surface the contrarian case: a crowded side is where a confident
 * challenger gets paid the most, and it is worth pointing at.
 */
export function crowdImbalance(odds: ImpliedOdds): number {
  if (odds.creatorProbability === null) return 0;
  return Math.abs(odds.creatorProbability - 0.5) * 2;
}
