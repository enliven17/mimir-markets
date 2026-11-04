import type { OnchainClaim } from "./client";
import type { OnchainClaim as DecisionClaim } from "../market-claim";
import { MIMIR_PROGRAM_ID } from "./config";

export const INDEX_SCALE = 1_000_000_000_000n;
const STATUSES = ["open", "active", "resolved", "cancelled", "proposed", "disputed"] as const;
export function indexedClaim(c: OnchainClaim, slot: number) {
  return {
    chain: "solana" as const, kind: "vs" as const, marketId: Number(c.id), creator: c.creator.toBase58(),
    question: c.question, labelA: c.creatorPosition, labelB: c.counterPosition, resolutionUrl: c.resolutionUrl,
    category: c.category, deadline: c.deadline, createdAt: c.createdAt, status: STATUSES[c.state],
    winner: c.state === 4 || c.state === 5 ? c.proposedSide : c.winnerSide, summary: c.resolutionSummary,
    stakeA: (c.creatorStake * INDEX_SCALE).toString(), stakeB: (c.totalChallengerStake * INDEX_SCALE).toString(),
    volumeUsd: Number(c.creatorStake + c.totalChallengerStake) / 1e6, participants: 1 + c.challengers.length,
    isPrivate: false, disputableUntil: c.disputableUntil,
    refundAt: (c.disputedAt || c.deadline) + c.resolutionGrace, updatedBlock: slot,
    platformFeeBps: c.platformFeeBps, agentFeeBps: c.agentFeeBps,
    feeRecipient: c.feeRecipient.toBase58(), maxChallengers: c.maxChallengers || 16,
  };
}
export function indexedPositions(c: OnchainClaim) {
  const leg = (user: string, side: number, amount: bigint, claimed: boolean) => ({
    chain: "solana" as const, kind: "vs" as const, marketId: Number(c.id), user, side,
    amount: (amount * INDEX_SCALE).toString(), amountUsd: Number(amount) / 1e6, claimed,
  });
  return [leg(c.creator.toBase58(), 1, c.creatorStake, c.creatorPaid), ...c.challengers.map(p => leg(p.addr.toBase58(), 2, p.stake, p.paid))];
}
export function decisionClaim(c: OnchainClaim): DecisionClaim {
  return { ...c, contract: MIMIR_PROGRAM_ID.toBase58(), creator: c.creator.toBase58(), creatorAgent: c.creatorAgent.toBase58(),
    feeRecipient: c.feeRecipient.toBase58(), disputer: c.disputer.toBase58(),
    challengers: c.challengers.map(p => ({ ...p, addr: p.addr.toBase58(), agent: p.agent.toBase58() })),
  };
}
