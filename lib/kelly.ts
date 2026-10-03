/**
 * Kelly Criterion: f* = (p * b - q) / b
 *   p = probability of winning (confidence/100)
 *   q = 1 - p
 *   b = net odds (payout ratio - 1, e.g. pool odds ≈ 1.0 for even)
 *
 * Returns the fraction of bankroll to bet (0–1), clamped to `cap`.
 * Callers pick their own safety cap (oracle 0.25, council personas 0.15).
 */
export function kellyFraction(confidencePct: number, cap: number, netOdds = 1.0): number {
  if (!(netOdds > 0)) return 0;
  const p = confidencePct / 100;
  const q = 1 - p;
  const f = (p * netOdds - q) / netOdds;
  return Math.max(0, Math.min(cap, f));
}

/**
 * A challenger's net odds on a Mimir claim (lib/solana/fees.ts
 * challengerGross): a winning challenger gets back its stake plus a
 * proportional share of the creator's stake, so with `stake` added to the pool
 *   b = creatorStake / (totalChallengerStake + stake).
 * Fees on profit are ignored (≤ 10%, they only shrink b a little further).
 */
export function challengerNetOdds(creatorStake: number, totalChallengerStake: number, stake: number): number {
  const pool = totalChallengerStake + stake;
  return pool > 0 && creatorStake > 0 ? creatorStake / pool : 0;
}

/**
 * Kelly stake (USDC) for a challenger at real pool odds. b falls as the stake
 * grows, so this is the largest stake s with s ≤ bankroll · f*(b(s)), found
 * by bisection, then capped at `maxCreatorMultiple` × the creator's stake
 * (more than that only dilutes your own winnings). Returns 0 when there is
 * no edge, and when even `minStake` would be a negative-EV bet.
 */
export function challengerKellyStake(args: {
  confidencePct: number;
  /** Max Kelly fraction of the bankroll. */
  cap: number;
  bankroll: number;
  creatorStake: number;
  totalChallengerStake: number;
  /** Stake ≤ this × creatorStake. Default 1. */
  maxCreatorMultiple?: number;
  /** Program minimum: below it the stake is rounded up if that is still +EV, else 0. */
  minStake?: number;
}): number {
  const { confidencePct, cap, bankroll, creatorStake, totalChallengerStake } = args;
  const minStake = args.minStake ?? 0;
  const ceiling = Math.min(bankroll * cap, (args.maxCreatorMultiple ?? 1) * creatorStake);
  if (!(ceiling > 0) || !(bankroll > 0)) return 0;
  const excess = (s: number) =>
    bankroll * kellyFraction(confidencePct, cap, challengerNetOdds(creatorStake, totalChallengerStake, s)) - s;
  let stake: number;
  if (excess(ceiling) >= 0) {
    stake = ceiling;
  } else {
    let lo = 0;
    let hi = ceiling;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (excess(mid) >= 0) lo = mid;
      else hi = mid;
    }
    stake = lo;
  }
  if (stake >= minStake) return stake;
  // Kelly wants less than the minimum: take the minimum only if it is still +EV.
  const p = confidencePct / 100;
  const b = challengerNetOdds(creatorStake, totalChallengerStake, minStake);
  return minStake <= ceiling && p * b - (1 - p) > 0 ? minStake : 0;
}
