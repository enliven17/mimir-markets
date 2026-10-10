/**
 * Which markets the oracle decides first (convex/arc.ts oracleWork). Opening markets is cheap, so a flood of tiny
 * markets must not starve real ones:
 *   - bigger pots first, in tiers (×10 USDC steps), so a 0.1 USDC market never jumps a 50 USDC one;
 *   - within a tier, the longest overdue first;
 *   - the single most overdue market always gets a slot once it has waited STARVE_SEC, whatever its size;
 *   - at most PER_CREATOR markets from one creator in one batch.
 * And when a decision is deferred, the next try backs off exponentially.
 */
export interface QueueMarket {
  kind: "vs" | "pool";
  marketId: number;
  creator: string;
  deadline: number;
  /** stakeA + stakeB in wei (18 decimals). */
  pot: bigint;
}

export const PER_CREATOR = 2;
export const STARVE_SEC = 6 * 3600;

const WEI = 10n ** 18n;

/** 0 below 1 USDC, 1 for 1–10, 2 for 10–100, … */
export function potTier(pot: bigint): number {
  let tier = 0;
  for (let t = WEI; pot >= t && tier < 12; t *= 10n) tier++;
  return tier;
}

export function orderDecisions<T extends QueueMarket>(candidates: T[], limit: number, now: number, perCreator = PER_CREATOR): T[] {
  const sorted = [...candidates].sort((a, b) => potTier(b.pot) - potTier(a.pot) || a.deadline - b.deadline || a.marketId - b.marketId);
  const out: T[] = [];
  const taken = new Map<string, number>();
  const add = (m: T) => {
    const c = m.creator.toLowerCase();
    if (out.includes(m) || (taken.get(c) ?? 0) >= perCreator) return false;
    taken.set(c, (taken.get(c) ?? 0) + 1);
    out.push(m);
    return true;
  };
  // The starvation floor: the oldest overdue market, if it has waited long enough.
  const oldest = [...candidates].sort((a, b) => a.deadline - b.deadline)[0];
  if (oldest && now - oldest.deadline >= STARVE_SEC) add(oldest);
  for (const m of sorted) {
    if (out.length >= limit) break;
    add(m);
  }
  return out.slice(0, limit);
}

/** Minutes until the next try after `attempts` deferrals: 2, 4, 8, … capped at `capMinutes` (6 hours by default). */
export function retryDelayMs(attempts: number, capMinutes = 360): number {
  const minutes = Math.min(2 ** Math.max(1, attempts), capMinutes);
  return minutes * 60_000;
}
