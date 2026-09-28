/**
 * Agent baskets: a weighted mix of agents with a stated thesis.
 *
 * A basket holds nothing. Following one is **mirroring, never depositing**: a
 * follower signs a message naming the basket and a per-market USDC cap, and
 * every copied position is a challenge from their own Mimir balance, signed by
 * their own wallet. Mimir only hands out signals and unsigned transactions;
 * nothing is pooled, so there is no vault to drain and no key to misplace.
 *
 * The published curve is a projection of what member agents actually settled
 * on chain, not a claim about money anyone deposited.
 *
 * Pure module: no DB, no RPC, safe to import from client components and tests.
 */
import {
  challengerGross,
  splitFees,
  MAX_TOTAL_FEE_BPS,
} from "./solana/fees";

/** 1 USDC in base units (6 decimals). */
export const ONE_USDC = 1_000_000n;

export const WEIGHT_TOTAL_BPS = 10_000;

/** The notional a virtual basket is replayed with: 1,000 USDC. */
export const VIRTUAL_BASKET_INITIAL_NAV = 1_000n * ONE_USDC;

/** The program's minimum stake: a cap below it could never mirror anything. */
export const MIN_FOLLOW_CAP_USDC = 2;
/** A single signature must never authorise unbounded exposure. */
export const MAX_FOLLOW_CAP_USDC = 100;
/** A signed basket message is only accepted this close to server time. */
export const BASKET_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export const BASKET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
/** Ids that collide with static routes (/baskets/new, /api/baskets/candidates). */
const RESERVED_BASKET_IDS = new Set(["new", "candidates"]);

export function isValidBasketId(id: string): boolean {
  return BASKET_ID_PATTERN.test(id) && !RESERVED_BASKET_IDS.has(id);
}
export const MAX_BASKET_NAME = 80;
export const MAX_BASKET_THESIS = 500;

export interface BasketMember {
  /** A registered agent id, or a council persona slug. */
  agentId: string;
  weightBps: number;
}

export interface BasketPolicy {
  /** No single agent may carry more than this share of a basket. */
  maxSingleAgentBps: number;
  /** Minimum distinct members, so a "basket" is not one agent with extra steps. */
  minMembers: number;
  maxMembers: number;
}

export const DEFAULT_BASKET_POLICY: BasketPolicy = {
  maxSingleAgentBps: 5_000,
  minMembers: 2,
  maxMembers: 12,
};

export interface BasketDefinition {
  id: string;
  name: string;
  thesis: string;
  /** Base58 Solana public key of the composer. */
  creatorWallet: string;
  members: BasketMember[];
  createdAt: number;
}

export type BasketRejectionReason =
  | "weights_must_total_10000_bps"
  | "duplicate_agent"
  | "bad_agent_id"
  | "non_positive_weight"
  | "weight_not_integer"
  | "single_agent_over_cap"
  | "too_few_members"
  | "too_many_members"
  | "missing_name"
  | "name_too_long"
  | "missing_thesis"
  | "thesis_too_long";

export class InvalidBasketError extends Error {
  constructor(
    readonly reason: BasketRejectionReason,
    message: string,
  ) {
    super(message);
    this.name = "InvalidBasketError";
  }
}

/** Member ids are agent ids or persona slugs: the same lowercase shape. */
const MEMBER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * Validate a basket before it is stored.
 *
 * Checks run in a fixed order and the first failure wins, so the same
 * definition always produces the same refusal.
 */
export function validateBasket(
  input: { name: string; thesis: string; members: BasketMember[] },
  policy: BasketPolicy = DEFAULT_BASKET_POLICY,
): void {
  const { name, thesis, members } = input;

  if (!name.trim()) throw new InvalidBasketError("missing_name", "a basket needs a name");
  if (name.trim().length > MAX_BASKET_NAME) {
    throw new InvalidBasketError("name_too_long", `a name is at most ${MAX_BASKET_NAME} characters`);
  }
  if (!thesis.trim()) {
    throw new InvalidBasketError("missing_thesis", "a basket needs a stated thesis");
  }
  if (thesis.trim().length > MAX_BASKET_THESIS) {
    throw new InvalidBasketError("thesis_too_long", `a thesis is at most ${MAX_BASKET_THESIS} characters`);
  }
  if (members.length < policy.minMembers) {
    throw new InvalidBasketError(
      "too_few_members",
      `a basket needs at least ${policy.minMembers} agents`,
    );
  }
  if (members.length > policy.maxMembers) {
    throw new InvalidBasketError(
      "too_many_members",
      `a basket may hold at most ${policy.maxMembers} agents`,
    );
  }

  const seen = new Set<string>();
  for (const m of members) {
    if (typeof m?.agentId !== "string" || !MEMBER_ID_PATTERN.test(m.agentId)) {
      throw new InvalidBasketError("bad_agent_id", "every member needs an agent id or persona slug");
    }
    if (seen.has(m.agentId)) {
      throw new InvalidBasketError("duplicate_agent", `${m.agentId} appears twice`);
    }
    seen.add(m.agentId);

    if (!Number.isInteger(m.weightBps)) {
      throw new InvalidBasketError("weight_not_integer", `${m.agentId} has a fractional weight`);
    }
    if (m.weightBps <= 0) {
      throw new InvalidBasketError("non_positive_weight", `${m.agentId} has a zero or negative weight`);
    }
    if (m.weightBps > policy.maxSingleAgentBps) {
      throw new InvalidBasketError(
        "single_agent_over_cap",
        `${m.agentId} is above the ${policy.maxSingleAgentBps} bps single-agent cap`,
      );
    }
  }

  const total = members.reduce((acc, m) => acc + m.weightBps, 0);
  if (total !== WEIGHT_TOTAL_BPS) {
    throw new InvalidBasketError(
      "weights_must_total_10000_bps",
      `weights total ${total} bps, they must total ${WEIGHT_TOTAL_BPS}`,
    );
  }
}

/** Only the two fields a member has, so extra JSON keys never reach storage. */
export function sanitizeMembers(raw: unknown): BasketMember[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => ({
    agentId: String((m as { agentId?: unknown })?.agentId ?? ""),
    weightBps: Number((m as { weightBps?: unknown })?.weightBps),
  }));
}

// ── Virtual NAV ─────────────────────────────────────────────────────────────

export interface MemberSettlement {
  agentId: string;
  /** Calendar day of the settlement, YYYY-MM-DD. */
  day: string;
  /** What the agent had staked in that market, base units. */
  stakeAtomic: bigint;
  /** Realized profit or loss after fees, base units. Negative when the agent lost. */
  pnlAtomic: bigint;
}

export interface NavPoint {
  day: string;
  navAtomic: bigint;
  /** Basket return for that day, as a fraction (0.012 = +1.2%). */
  dailyReturn: number;
  /** Drawdown against the running high, as a non-positive fraction. */
  drawdown: number;
}

export interface BasketPerformance {
  points: NavPoint[];
  finalNavAtomic: bigint;
  totalReturn: number;
  maxDrawdown: number;
  /** Members that never settled anything in the window. */
  idleAgents: string[];
}

/**
 * Replay a hypothetical allocation through what the members actually settled.
 *
 *  - **Stake-weighted, not vote-weighted.** A member's daily return is its
 *    total PnL over its total stake that day.
 *  - **A day with no settlements produces no point.**
 *  - **An idle leg earns zero, not the basket average**, which is what
 *    sitting in USDC actually pays.
 */
export function simulateVirtualBasket(
  members: BasketMember[],
  settlements: MemberSettlement[],
  initialNav: bigint = VIRTUAL_BASKET_INITIAL_NAV,
): BasketPerformance {
  const weights = new Map(members.map((m) => [m.agentId, m.weightBps]));
  const relevant = settlements.filter((s) => weights.has(s.agentId));

  const byDay = new Map<string, Map<string, { stake: bigint; pnl: bigint }>>();
  for (const s of relevant) {
    const day = byDay.get(s.day) ?? new Map<string, { stake: bigint; pnl: bigint }>();
    const prev = day.get(s.agentId) ?? { stake: 0n, pnl: 0n };
    day.set(s.agentId, { stake: prev.stake + s.stakeAtomic, pnl: prev.pnl + s.pnlAtomic });
    byDay.set(s.day, day);
  }

  const days = [...byDay.keys()].sort();
  const points: NavPoint[] = [];

  let nav = initialNav;
  let runningHigh = initialNav;
  let maxDrawdown = 0;

  for (const day of days) {
    const perAgent = byDay.get(day)!;
    let dailyReturn = 0;
    for (const [agentId, { stake, pnl }] of perAgent) {
      if (stake === 0n) continue;
      const weight = (weights.get(agentId) ?? 0) / WEIGHT_TOTAL_BPS;
      // Ratios are small and bounded, so float is fine; the NAV stays integer.
      dailyReturn += weight * (Number(pnl) / Number(stake));
    }

    nav = nav + BigInt(Math.trunc(Number(nav) * dailyReturn));
    if (nav < 0n) nav = 0n;
    if (nav > runningHigh) runningHigh = nav;

    // Guarded so a new high reports 0 rather than -0, which reads as a loss.
    const drawdown =
      runningHigh === 0n || nav >= runningHigh
        ? 0
        : -(Number(runningHigh - nav) / Number(runningHigh));
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;

    points.push({ day, navAtomic: nav, dailyReturn, drawdown });
  }

  const active = new Set(relevant.map((s) => s.agentId));
  const idleAgents = members.map((m) => m.agentId).filter((id) => !active.has(id));

  return {
    points,
    finalNavAtomic: nav,
    totalReturn: initialNav === 0n ? 0 : Number(nav - initialNav) / Number(initialNav),
    maxDrawdown,
    idleAgents,
  };
}

// ── Claims from the read index → settlements and signals ──────────────────

/** The slice of a `solana_claims` row this module reads. */
export interface IndexedClaim {
  id: number;
  creator: string;
  state: number;
  winner_side: number;
  creator_stake: string;
  total_challenger_stake: string;
  deadline: number;
  resolved_at?: number;
  max_challengers: number;
  delegated: boolean;
  platform_fee_bps?: number;
  agent_fee_bps?: number;
  challengers: { addr: string; stake: string; paid?: boolean; agent?: string }[];
}

// Mirrors lib/solana/config.ts (kept literal so this module stays RPC-free).
const ST_OPEN = 0;
const ST_ACTIVE = 1;
const ST_RESOLVED = 2;
const SIDE_CREATOR = 1;
const MIN_STAKE_UNITS = 2n * ONE_USDC;

function units(value: string | number | bigint | undefined): bigint {
  try {
    const v = BigInt(value ?? 0);
    return v > 0n ? v : 0n;
  } catch {
    return 0n;
  }
}

function dayOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Realized PnL of one challenger position on a RESOLVED claim, after the
 * program's profit-only fees (frozen per claim). A creator win costs the
 * stake; a draw or an unresolvable verdict refunds it in full, so it is zero.
 */
export function challengerPnlUnits(
  claim: IndexedClaim,
  position: { addr: string; stake: string; agent?: string },
): bigint {
  const stake = units(position.stake);
  if (stake === 0n) return 0n;
  if (claim.winner_side === SIDE_CREATOR) return -stake;
  const gross = challengerGross(
    claim.winner_side,
    stake,
    units(claim.creator_stake),
    units(claim.total_challenger_stake),
  );
  if (!gross) return 0n;
  const platformFeeBps = Number(claim.platform_fee_bps ?? 0);
  const agentOwnerFeeBps = Number(claim.agent_fee_bps ?? 0);
  if (platformFeeBps + agentOwnerFeeBps > MAX_TOTAL_FEE_BPS) return gross.gross - gross.principal;
  const split = splitFees({
    gross: gross.gross,
    principal: gross.principal,
    // The recipient is not in the index; any key other than the winner charges the leg.
    policy: { platformFeeBps, agentOwnerFeeBps, platformRecipient: platformFeeBps > 0 ? "platform" : null },
    winner: position.addr,
    agentOwner: position.agent && position.agent !== position.addr ? position.agent : null,
  });
  return split.netPayout - stake;
}

/**
 * Settled outcomes for a basket's members. Only RESOLVED claims count:
 * PROPOSED and DISPUTED verdicts can still flip, and a cancelled claim was a
 * refund, not a decision.
 */
export function settlementsFromClaims(
  claims: IndexedClaim[],
  agentByWallet: Map<string, string>,
): MemberSettlement[] {
  const out: MemberSettlement[] = [];
  for (const c of claims) {
    if (c.state !== ST_RESOLVED) continue;
    const day = dayOf(c.resolved_at && c.resolved_at > 0 ? c.resolved_at : c.deadline);
    for (const ch of c.challengers ?? []) {
      const agentId = agentByWallet.get(ch.addr);
      if (!agentId) continue;
      const stake = units(ch.stake);
      if (stake === 0n) continue;
      out.push({ agentId, day, stakeAtomic: stake, pnlAtomic: challengerPnlUnits(c, ch) });
    }
  }
  return out;
}

/** A position a basket member holds that a follower can copy right now. */
export interface MirrorSignal {
  claimId: number;
  /** Members holding this claim, with the stake they put in. */
  members: { agentId: string; stakeUnits: string }[];
  /** What the follower would stake: the member stake, capped by the follower's cap. */
  suggestedStakeUnits: string;
  /** Where the challenge lands: the ER when the claim is delegated there. */
  layer: "base" | "er";
  deadline: number;
}

/**
 * Open positions of a basket's members that `follower` has not copied yet.
 * The follower may not challenge their own claim, a full claim, or a closed
 * one; a cap below the program minimum mirrors nothing.
 */
export function mirrorSignals(args: {
  claims: IndexedClaim[];
  agentByWallet: Map<string, string>;
  follower: string | null;
  perMarketCapUsdc: number;
  nowSec?: number;
}): MirrorSignal[] {
  const { claims, agentByWallet, follower } = args;
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
  const capUnits = BigInt(Math.floor(Math.max(0, args.perMarketCapUsdc) * 1_000_000));
  const out: MirrorSignal[] = [];

  for (const c of claims) {
    if (c.state !== ST_OPEN && c.state !== ST_ACTIVE) continue;
    if (c.deadline <= nowSec) continue;
    const challengers = c.challengers ?? [];
    if (follower && (c.creator === follower || challengers.some((ch) => ch.addr === follower))) continue;
    if (c.max_challengers > 0 && challengers.length >= c.max_challengers) continue;

    const members: MirrorSignal["members"] = [];
    let largest = 0n;
    for (const ch of challengers) {
      const agentId = agentByWallet.get(ch.addr);
      if (!agentId) continue;
      const stake = units(ch.stake);
      members.push({ agentId, stakeUnits: stake.toString() });
      if (stake > largest) largest = stake;
    }
    if (members.length === 0) continue;

    let suggested = follower ? (largest < capUnits ? largest : capUnits) : largest;
    if (suggested < MIN_STAKE_UNITS) suggested = follower ? 0n : MIN_STAKE_UNITS;
    if (follower && (capUnits < MIN_STAKE_UNITS || suggested === 0n)) continue;

    out.push({
      claimId: c.id,
      members,
      suggestedStakeUnits: suggested.toString(),
      layer: c.delegated ? "er" : "base",
      deadline: c.deadline,
    });
  }
  return out.sort((a, b) => a.deadline - b.deadline);
}

// ── Signed messages ────────────────────────────────────────────────────────

/**
 * The message a composer signs (ed25519, base58) when publishing a basket.
 * Creating a basket moves nothing, but it carries the composer's key, so it is
 * signed: otherwise anyone could publish a thesis under someone else's wallet.
 * Name, thesis and weights are spelled out so the prompt shows what is claimed.
 */
export function composeMessage(args: {
  id: string;
  name: string;
  thesis: string;
  creator: string;
  members: BasketMember[];
  signedAt: number;
}): string {
  return [
    "Mimir basket (Solana)",
    `id: ${args.id}`,
    `name: ${args.name}`,
    `thesis: ${args.thesis}`,
    `creator: ${args.creator}`,
    ...args.members.map((m) => `  ${m.agentId}: ${m.weightBps} bps`),
    `signedAt: ${args.signedAt}`,
  ].join("\n");
}

/**
 * The message a follower signs. It names the basket, the follower (base58,
 * exact case) and the cap, so what is approved is legible in the wallet
 * prompt. Unfollowing is the same signature with the cap set to zero.
 *
 * `signedAt` (ms) makes every signature single-use in practice: the server
 * only accepts one inside a short window and newer than the last one it
 * stored, so an old "cap 50" cannot be replayed after an unfollow.
 */
export function followMessage(args: {
  basketId: string;
  follower: string;
  perMarketCapUsdc: number;
  signedAt: number;
}): string {
  return [
    "Mimir basket subscription (Solana)",
    `basket: ${args.basketId}`,
    `follower: ${args.follower}`,
    `perMarketCapUsdc: ${args.perMarketCapUsdc}`,
    `signedAt: ${args.signedAt}`,
    "Positions are staked from your own balance with your own signature.",
    "Nothing is deposited and nothing is pooled.",
  ].join("\n");
}

/** Is a signed timestamp fresh enough to accept? */
export function isFreshSignature(signedAt: number, now = Date.now()): boolean {
  return Number.isFinite(signedAt) && Math.abs(now - signedAt) <= BASKET_SIGNATURE_MAX_SKEW_MS;
}

/** A cap is zero (unfollow) or between the program minimum and the ceiling. */
export function isValidFollowCap(cap: number): boolean {
  if (!Number.isFinite(cap)) return false;
  if (cap === 0) return true;
  return cap >= MIN_FOLLOW_CAP_USDC && cap <= MAX_FOLLOW_CAP_USDC;
}

/** Worst case a follower can be on the hook for across a basket's members. */
export function worstCaseFollowerExposure(members: BasketMember[], perMarketCapUsdc: number): number {
  return members.length * perMarketCapUsdc;
}
