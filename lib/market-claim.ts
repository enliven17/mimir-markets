/**
 * The market shape the oracle and the council read: a MimirV3 VS market or a MimirPool pool (convex/arcOracle.ts and
 * convex/arcCouncil.ts build it from the Arc index). Addresses are lowercase 0x strings. Pure types.
 */
export interface OnchainChallenger {
  addr: string;
  stake: bigint;
  paid: boolean;
  /** Agent owner credited for this position ("" = none). */
  agent: string;
}

export interface OnchainClaim {
  id: bigint;
  /** The market's contract (MimirV3 or MimirPool), named in the verdict bundle. */
  contract?: string;
  creator: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  creatorStake: bigint;
  totalChallengerStake: bigint;
  deadline: number;
  state: number;
  winnerSide: number;
  /** Proposal summary while PROPOSED/DISPUTED, final summary once RESOLVED. */
  resolutionSummary: string;
  confidence: number;
  evidenceHash: Uint8Array;
  createdAt: number;
  maxChallengers: number;
  creatorPaid: boolean;
  challengers: OnchainChallenger[];
  // Fee terms frozen at creation
  creatorAgent: string;
  feeRecipient: string;
  platformFeeBps: number;
  agentFeeBps: number;
  totalFees: bigint;
  // Optimistic resolution
  disputeWindow: number;
  resolutionGrace: number;
  proposedSide: number;
  proposedAt: number;
  disputableUntil: number;
  disputer: string;
  disputedAt: number;
  bond: bigint;
  bondState: number;
  resolvedAt: number;
}

