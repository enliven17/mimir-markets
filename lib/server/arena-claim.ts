/**
 * The claim shape /api/arena/* serves, built from either the read index row or
 * a chain read, so both paths hand pages the same V3 fields.
 */
import { PublicKey } from "@solana/web3.js";
import type { OnchainClaim } from "../solana/client";
import type { SolanaClaimRow } from "./solana-index";

export interface ApiChallenger {
  addr: string;
  stake: string;
  paid: boolean;
  /** Agent owner credited with the agent fee, '' when none. */
  agent?: string;
}

export interface ApiClaim {
  id: number;
  creator: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  creatorStake: string;
  totalChallengerStake: string;
  deadline: number;
  state: number;
  winnerSide: number;
  resolutionSummary: string;
  confidence: number;
  createdAt: number;
  maxChallengers: number;
  delegated: boolean;
  challengers: ApiChallenger[];
  // ── V3 lifecycle ──
  creatorPaid: boolean;
  proposedSide: number;
  proposedAt: number;
  disputableUntil: number;
  disputer: string;
  disputedAt: number;
  bond: string;
  bondState: number;
  disputeWindow: number;
  resolutionGrace: number;
  resolvedAt: number;
  creatorAgent: string;
  platformFeeBps: number;
  agentFeeBps: number;
  totalFees: string;
}

/** PublicKey.default (all zeros) means "none" on-chain. */
const keyOrEmpty = (k: PublicKey): string => (k.equals(PublicKey.default) ? "" : k.toBase58());

export function rowToApi(c: SolanaClaimRow): ApiClaim {
  return {
    id: c.id,
    creator: c.creator,
    question: c.question,
    creatorPosition: c.creator_position,
    counterPosition: c.counter_position,
    resolutionUrl: c.resolution_url,
    category: c.category,
    creatorStake: c.creator_stake,
    totalChallengerStake: c.total_challenger_stake,
    deadline: c.deadline,
    state: c.state,
    winnerSide: c.winner_side,
    resolutionSummary: c.resolution_summary,
    confidence: c.confidence,
    createdAt: c.created_at,
    maxChallengers: c.max_challengers,
    delegated: c.delegated,
    challengers: c.challengers,
    creatorPaid: Boolean(c.creator_paid),
    proposedSide: c.proposed_side ?? 0,
    proposedAt: c.proposed_at ?? 0,
    disputableUntil: c.disputable_until ?? 0,
    disputer: c.disputer ?? "",
    disputedAt: c.disputed_at ?? 0,
    bond: c.bond ?? "0",
    bondState: c.bond_state ?? 0,
    disputeWindow: c.dispute_window ?? 0,
    resolutionGrace: c.resolution_grace ?? 0,
    resolvedAt: c.resolved_at ?? 0,
    creatorAgent: c.creator_agent ?? "",
    platformFeeBps: c.platform_fee_bps ?? 0,
    agentFeeBps: c.agent_fee_bps ?? 0,
    totalFees: c.total_fees ?? "0",
  };
}

export function claimToApi(claim: OnchainClaim, delegated: boolean): ApiClaim {
  return {
    id: Number(claim.id),
    creator: claim.creator.toBase58(),
    question: claim.question,
    creatorPosition: claim.creatorPosition,
    counterPosition: claim.counterPosition,
    resolutionUrl: claim.resolutionUrl,
    category: claim.category,
    creatorStake: claim.creatorStake.toString(),
    totalChallengerStake: claim.totalChallengerStake.toString(),
    deadline: claim.deadline,
    state: claim.state,
    winnerSide: claim.winnerSide,
    resolutionSummary: claim.resolutionSummary,
    confidence: claim.confidence,
    createdAt: claim.createdAt,
    maxChallengers: claim.maxChallengers,
    delegated,
    challengers: claim.challengers.map((c) => ({
      addr: c.addr.toBase58(),
      stake: c.stake.toString(),
      paid: c.paid,
      agent: keyOrEmpty(c.agent),
    })),
    creatorPaid: claim.creatorPaid,
    proposedSide: claim.proposedSide,
    proposedAt: claim.proposedAt,
    disputableUntil: claim.disputableUntil,
    disputer: keyOrEmpty(claim.disputer),
    disputedAt: claim.disputedAt,
    bond: claim.bond.toString(),
    bondState: claim.bondState,
    disputeWindow: claim.disputeWindow,
    resolutionGrace: claim.resolutionGrace,
    resolvedAt: claim.resolvedAt,
    creatorAgent: keyOrEmpty(claim.creatorAgent),
    platformFeeBps: claim.platformFeeBps,
    agentFeeBps: claim.agentFeeBps,
    totalFees: claim.totalFees.toString(),
  };
}
