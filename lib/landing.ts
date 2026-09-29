/**
 * Pure selectors behind the landing page: the live strip numbers, the ticker,
 * the featured claim and the ledger, all computed from the real arena feed
 * (`GET /api/arena/claims`). No fallbacks to made-up values: an empty feed
 * gives zeros, empty lists and `null`.
 */
import { claimPhase, holdsStakes, isLiveState, type ClaimPhase } from "./claim-status";
import { confidenceTier } from "./settlement-preview";
import { unitsToUsdc } from "./money";
import { ST_RESOLVED } from "./solana/config";

export interface LandingChallenger {
  addr: string;
  stake: string;
}

/** The subset of the API claim the landing reads. */
export interface LandingClaim {
  id: number;
  question: string;
  category: string;
  creatorPosition: string;
  counterPosition: string;
  creatorStake: string;
  totalChallengerStake: string;
  deadline: number;
  state: number;
  winnerSide: number;
  confidence: number;
  resolutionSummary: string;
  delegated: boolean;
  maxChallengers?: number;
  resolvedAt?: number;
  challengers: LandingChallenger[];
}

export interface LandingFeed {
  claims: LandingClaim[];
  claimCount: number;
  totalResolved: number;
  /** Base units, as a decimal string. */
  openPool: string;
}

export interface LiveStats {
  markets: number;
  resolved: number;
  /** USDC (not base units). */
  openPool: number;
  /** Live claims (open / active) whose market runs inside the Ephemeral Rollup. */
  liveOnEr: number;
}

/** Creator stake plus every challenger stake, in USDC. */
export function poolUsdc(c: Pick<LandingClaim, "creatorStake" | "totalChallengerStake">): number {
  return unitsToUsdc(c.creatorStake) + unitsToUsdc(c.totalChallengerStake);
}

export function liveStats(feed: LandingFeed | null): LiveStats {
  if (!feed) return { markets: 0, resolved: 0, openPool: 0, liveOnEr: 0 };
  return {
    markets: feed.claimCount,
    resolved: feed.totalResolved,
    openPool: unitsToUsdc(feed.openPool),
    liveOnEr: feed.claims.filter((c) => isLiveState(c.state) && c.delegated).length,
  };
}

/** Newest claims for the ticker, newest first. */
export function tickerClaims(feed: LandingFeed | null, limit = 12): LandingClaim[] {
  if (!feed) return [];
  return [...feed.claims].sort((a, b) => b.id - a.id).slice(0, limit);
}

/**
 * The claim the inspector shows: a live claim that still takes positions
 * (deadline ahead), biggest pool first, newest on a tie. Falls back to any
 * claim that still holds stakes, so the section shows something real while a
 * verdict is pending. `null` when nothing is live.
 */
export function featuredClaim(feed: LandingFeed | null, now = Math.floor(Date.now() / 1000)): LandingClaim | null {
  if (!feed) return null;
  const byPool = (a: LandingClaim, b: LandingClaim) => poolUsdc(b) - poolUsdc(a) || b.id - a.id;
  const open = feed.claims.filter((c) => isLiveState(c.state) && c.deadline > now).sort(byPool);
  if (open.length > 0) return open[0];
  const holding = feed.claims.filter((c) => holdsStakes(c.state)).sort(byPool);
  return holding[0] ?? null;
}

export type LedgerTag = "firm" | "contested" | "refund";

export interface LedgerEntry {
  claim: LandingClaim;
  tag: LedgerTag;
  /** 1 creator, 2 challengers, 3 draw, 4 unresolvable. */
  side: number;
  pool: number;
}

/** Settled claims for the ledger rail, most recently resolved first. */
export function ledgerEntries(feed: LandingFeed | null, limit = 6): LedgerEntry[] {
  if (!feed) return [];
  return feed.claims
    .filter((c) => c.state === ST_RESOLVED && c.winnerSide !== 0)
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0) || b.id - a.id)
    .slice(0, limit)
    .map((claim) => {
      const tier = confidenceTier(claim.winnerSide, claim.confidence, claim.resolutionSummary ?? "");
      const tag: LedgerTag = tier === "refunded" ? "refund" : tier === "contested" ? "contested" : "firm";
      return { claim, tag, side: claim.winnerSide, pool: poolUsdc(claim) };
    });
}

/** Share of the pool on the creator's side, 0..1 (0.5 for an empty pool). */
export function creatorShare(c: Pick<LandingClaim, "creatorStake" | "totalChallengerStake">): number {
  const creator = unitsToUsdc(c.creatorStake);
  const total = creator + unitsToUsdc(c.totalChallengerStake);
  return total > 0 ? creator / total : 0.5;
}

export function landingPhase(c: LandingClaim, now = Math.floor(Date.now() / 1000)): ClaimPhase {
  return claimPhase(c.state, c.deadline, now);
}

/** "2d 4h", "3h 12m", "8m", "closed": time left until `deadline` (unix seconds). */
export function timeLeft(deadline: number, now = Math.floor(Date.now() / 1000)): string {
  const s = deadline - now;
  if (s <= 0) return "closed";
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}
