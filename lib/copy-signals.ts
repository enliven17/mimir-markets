/**
 * Turning a signal agent's indexed positions into gated copy instructions.
 *
 * Pure: the IO wrapper (lib/server/copy-signals.ts) reads the claims through
 * the same basket helper that powers mirror signals and hands them here.
 *
 * Mimir does not place the copy. The follower's own registered execution
 * agent asks what it may copy, gets a gated answer with a size attached, and
 * stakes it with its own operator key through the agent API's unsigned
 * challenge transaction. Mimir decides what is permitted; the agent decides
 * whether to act; only the agent's key can move the money.
 */
import { computeClaimQuality } from "./claimQuality";
import {
  evaluateCopy,
  type CopyDecision,
  type CopyPermission,
  type CopySignal,
  type CopyUsage,
} from "./copy-trading";
import type { IndexedClaim } from "./baskets";

// Mirrors lib/solana/config.ts (kept literal so this module stays RPC-free).
const ST_OPEN = 0;
const ST_ACTIVE = 1;

export interface CandidateSignal {
  signal: CopySignal;
  question: string;
  /** Where the copy's challenge lands: the ER when the claim is delegated there. */
  layer: "base" | "er";
  deadline: number;
}

export interface CopyInstruction {
  permissionId: string;
  claimId: number;
  signalAgentId: string;
  question: string;
  category: string;
  layer: "base" | "er";
  deadline: number;
  claimQuality: number;
  payoutRatio: number;
  decision: CopyDecision;
}

function usdc(units: string | undefined): number {
  try {
    return Number(BigInt(units ?? "0")) / 1_000_000;
  } catch {
    return 0;
  }
}

/**
 * Live challenger positions of `signalWallet` that a new challenger could
 * still join: OPEN or ACTIVE, before the deadline, with a free seat. Claims
 * the executing wallet already sits in are returned too, so the gate can name
 * them as duplicates rather than have them silently vanish.
 */
export function candidateSignals(args: {
  claims: IndexedClaim[];
  signalWallet: string;
  signalAgentId: string;
  now?: number;
}): CandidateSignal[] {
  const now = args.now ?? Date.now();
  const nowSec = Math.floor(now / 1000);
  const out: CandidateSignal[] = [];

  for (const c of args.claims) {
    if (c.state !== ST_OPEN && c.state !== ST_ACTIVE) continue;
    if (c.deadline <= nowSec) continue;
    const challengers = c.challengers ?? [];
    if (c.max_challengers > 0 && challengers.length >= c.max_challengers) continue;
    const position = challengers.find((ch) => ch.addr === args.signalWallet);
    if (!position) continue;

    const creatorStake = usdc(c.creator_stake);
    const challengerStake = usdc(c.total_challenger_stake);
    const quality = computeClaimQuality(
      {
        question: c.question ?? "",
        creator_position: c.creator_position ?? "",
        opponent_position: c.counter_position ?? "",
        resolution_url: c.resolution_url ?? "",
        settlement_rule: "",
        category: c.category || "custom",
        deadline: c.deadline,
      },
      nowSec,
    );

    out.push({
      signal: {
        signalAgentId: args.signalAgentId,
        claimId: c.id,
        category: c.category || "custom",
        stakeUsdc: usdc(position.stake),
        claimQuality: quality.score,
        // What a challenger joining now is paid per unit staked (pool odds, before fees).
        payoutRatio: challengerStake > 0 ? Math.round((1 + creatorStake / challengerStake) * 100) / 100 : 2,
        // The read index does not carry the time a challenge landed, so a live
        // position counts as current. The claim filters above (live, joinable,
        // before the deadline) are what keeps a dead signal out.
        placedAt: now,
      },
      question: c.question ?? "",
      layer: c.delegated ? "er" : "base",
      deadline: c.deadline,
    });
  }
  return out.sort((a, b) => a.deadline - b.deadline);
}

/** Claims the executing wallet already created or challenged, per the index. */
export function claimsHeldBy(claims: IndexedClaim[], wallet: string): number[] {
  return claims
    .filter((c) => c.creator === wallet || (c.challengers ?? []).some((ch) => ch.addr === wallet))
    .map((c) => c.id);
}

/**
 * Gate every candidate for one permission. Caps are consumed as the loop
 * allocates, so two signals in one batch cannot each be sized against the
 * same untouched daily headroom. Skips are returned with their reason.
 */
export function planCopies(args: {
  permission: CopyPermission;
  candidates: CandidateSignal[];
  usage: CopyUsage;
  now?: number;
  globallyPaused?: boolean;
}): CopyInstruction[] {
  const { permission, candidates, now = Date.now(), globallyPaused = false } = args;
  const running: CopyUsage = { ...args.usage, heldClaimIds: [...args.usage.heldClaimIds] };
  const out: CopyInstruction[] = [];

  for (const c of candidates) {
    const decision = evaluateCopy({ permission, signal: c.signal, usage: running, now, globallyPaused });
    out.push({
      permissionId: permission.id,
      claimId: c.signal.claimId,
      signalAgentId: permission.signalAgentId,
      question: c.question,
      category: c.signal.category,
      layer: c.layer,
      deadline: c.deadline,
      claimQuality: c.signal.claimQuality,
      payoutRatio: c.signal.payoutRatio,
      decision,
    });
    if (decision.allowed) {
      running.spentTodayUsdc += decision.stakeUsdc;
      running.spentThisWeekUsdc += decision.stakeUsdc;
      running.openExposureUsdc += decision.stakeUsdc;
      running.heldClaimIds.push(c.signal.claimId);
    }
  }
  return out;
}
