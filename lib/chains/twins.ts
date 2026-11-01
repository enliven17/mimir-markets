/**
 * Twins: every public pool should exist on every enabled market chain, so a user stakes on whichever chain they want.
 * The twin reconciler (convex/arcTwins.ts) finds pools missing a leg and opens it from Mimir's house creator wallet on
 * that chain, with the same question, labels, category, deadline and source, then links the legs (lib/chains/linked.ts).
 *
 *   house drafts      the creator opens every chain itself; a chain that failed (no ETH, no USDC, a Circle error) is
 *                     filled in here later, seeded like the creator (CREATOR_STAKE_USDC on side A).
 *   user / agent pool once indexed and past moderation (local rules + Jev when on) and triage (arcTriage), the house
 *                     opens the twin with the target chain's MINIMUM stake on the side the creator staked. That seed is
 *                     Mimir's money and counts against the one house budget shared by every chain
 *                     (CREATOR_DAILY_BUDGET_USDC, convex/houseBudget.ts).
 *   VS duels          personal challenges: never mirrored.
 *
 * Pure: tests/node/chain-twins.test.ts.
 */
import type { MarketChainId } from "./registry";

export interface TwinSource {
  chain: MarketChainId;
  kind: "vs" | "pool";
  marketId: number;
  creator: string;
  question: string;
  labelA: string;
  labelB: string;
  resolutionUrl: string;
  category: string;
  deadline: number;
  createdAt: number;
  lockAt?: number;
  status: string;
  isPrivate: boolean;
  pairKey?: string;
  /** The side the creator's opening stake backs (1 A, 2 B), when known. */
  creatorSide: number | null;
}

export interface TwinContext {
  /** Unix seconds. */
  now: number;
  target: MarketChainId;
  /** The target pool's minimum stake, index units. */
  targetMinStakeWei: bigint;
  /** The house creator's address on the target chain (lowercase); null = no wallet there. */
  houseWallet: string | null;
  /** Every house creator address on any chain (lowercase): a source opened by one of them is a house draft. */
  houseAddresses: ReadonlySet<string>;
  /** What the house creator seeds its own drafts with, index units. */
  houseStakeWei: bigint;
  /** What is left of today's house budget (all chains together), index units. */
  budgetLeftWei: bigint;
  /** Jev triage is on (TYPESAFE_API_KEY); then a user pool waits for its triage row, up to triageGraceSeconds. */
  jevOn: boolean;
  triage: { spam: number; resolvable: number } | null;
  /** Claim moderation of the question: "block" skips, "allow"/null (no confident answer) passes the local rules' result. */
  moderation: "allow" | "block" | null;
  /** Twins the house already opened today for this source's creator, and the cap (TWIN_PER_CREATOR_DAY). */
  creatorTwinsToday: number;
  perCreatorDay: number;
  /** The contracts' betting lock before the deadline (CHALLENGE_LOCK_SECONDS). */
  lockSeconds?: number;
  /** A twin must stay open for stakes at least this long after it opens (TWIN_MIN_LEAD_MINUTES). */
  minLeadSeconds?: number;
  triageGraceSeconds?: number;
}

export type TwinPlan =
  | { action: "open"; side: 1 | 2; seedWei: bigint; pairKey: string; house: boolean }
  | { action: "skip"; reason: string }
  | { action: "wait"; reason: string };

/** Spam / unresolvable thresholds, as the council's (lib/jev-triage.ts skipTake). */
const SPAM_SKIP_AT = 0.85;
const RESOLVABLE_SKIP_AT = 0.15;
/** The contracts refuse a deadline more than a year out. */
const MAX_DEADLINE_AHEAD = 365 * 86_400;

/** The link a twin joins: the source's own pairKey, else one named after the source market. */
export const twinPairKey = (s: Pick<TwinSource, "pairKey" | "chain" | "kind" | "marketId">): string => s.pairKey ?? `twin:${s.chain}:${s.kind}:${s.marketId}`;

/** A house draft: opened by a house creator wallet, or carrying the house's pairKey. */
export const isHouseSource = (s: Pick<TwinSource, "creator" | "pairKey">, house: ReadonlySet<string>): boolean =>
  house.has(s.creator.toLowerCase()) || Boolean(s.pairKey?.startsWith("house:"));

/** When the twin would stop taking stakes: the lock before the deadline, or an early lock (setLockAt) if sooner. */
export function closesAt(s: Pick<TwinSource, "deadline" | "lockAt">, lockSeconds = 60): number {
  const lock = s.deadline - lockSeconds;
  return s.lockAt && s.lockAt > 0 && s.lockAt < lock ? s.lockAt : lock;
}

/** What to do about one source's missing leg on ctx.target. */
export function planTwin(s: TwinSource, ctx: TwinContext): TwinPlan {
  const lockSeconds = ctx.lockSeconds ?? 60;
  const minLead = ctx.minLeadSeconds ?? 30 * 60;
  const house = isHouseSource(s, ctx.houseAddresses);
  // Final skips: nothing changes them later.
  if (s.kind !== "pool") return { action: "skip", reason: "VS duels are personal challenges: not mirrored" };
  if (s.isPrivate) return { action: "skip", reason: "private market" };
  if (s.status !== "open") return { action: "skip", reason: `source is ${s.status}` };
  if (s.chain === ctx.target) return { action: "skip", reason: "same chain" };
  if (s.deadline - ctx.now > MAX_DEADLINE_AHEAD) return { action: "skip", reason: "deadline more than a year out (the contracts refuse it)" };
  if (closesAt(s, lockSeconds) - ctx.now < minLead) return { action: "skip", reason: "betting closes too soon to open a twin" };
  if (!house) {
    if (ctx.moderation === "block") return { action: "skip", reason: "blocked by claim moderation" };
    if (ctx.triage && (ctx.triage.spam >= SPAM_SKIP_AT || ctx.triage.resolvable <= RESOLVABLE_SKIP_AT)) {
      return { action: "skip", reason: "triage: spam or cannot be settled" };
    }
  }
  // Waits: retried on a later pass while the market is still far enough from closing.
  if (!ctx.houseWallet) return { action: "wait", reason: `no house creator wallet on ${ctx.target}` };
  if (!house && ctx.jevOn && !ctx.triage && ctx.now - s.createdAt < (ctx.triageGraceSeconds ?? 30 * 60)) {
    return { action: "wait", reason: "waiting for triage" };
  }
  if (!house && ctx.creatorTwinsToday >= ctx.perCreatorDay) return { action: "wait", reason: "creator's twins for today used" };
  const seedWei = house && ctx.houseStakeWei > ctx.targetMinStakeWei ? ctx.houseStakeWei : ctx.targetMinStakeWei;
  if (seedWei > ctx.budgetLeftWei) return { action: "wait", reason: "house budget for today used" };
  const side: 1 | 2 = s.creatorSide === 2 ? 2 : 1;
  return { action: "open", side, seedWei, pairKey: twinPairKey(s), house };
}

const norm = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The same market on another chain: question, sides, source and deadline match. The reconciler adopts (links) such a
 * market instead of opening another, which also closes the gap when a twin was opened but its link was lost.
 */
export function sameMarket(
  a: Pick<TwinSource, "question" | "labelA" | "labelB" | "resolutionUrl" | "deadline">,
  b: Pick<TwinSource, "question" | "labelA" | "labelB" | "resolutionUrl" | "deadline">,
): boolean {
  return a.deadline === b.deadline && norm(a.question) === norm(b.question) && norm(a.labelA) === norm(b.labelA) && norm(a.labelB) === norm(b.labelB) && a.resolutionUrl.trim() === b.resolutionUrl.trim();
}

/** The UTC day a spend belongs to ("2026-11-01"). */
export const budgetDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Whether a spend of `wei` fits today's shared house budget. `spentWei` is everything the house creator put on markets
 * today on every chain (its own drafts and twins alike).
 */
export const fitsBudget = (budgetWei: bigint, spentWei: bigint, wei: bigint): boolean => wei > 0n && spentWei + wei <= budgetWei;
