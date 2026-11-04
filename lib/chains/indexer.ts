/**
 * The market indexer's pure part (convex/arcSync.ts): the events and views both contract generations share (Arc's
 * native MimirV3 / MimirPool and Base's MimirV3Erc20 / MimirPoolErc20 keep the same events and view signatures), and a
 * decoded log as an arcEvents row with its amount in index units (lib/chains/amounts.ts). tests/node/chain-indexer.test.ts.
 */
import { parseAbi, type Log } from "viem";

import { indexString } from "./amounts";
import type { MarketChain } from "./registry";

export type Kind = "vs" | "pool";
export type DecodedLog = Log<bigint, number, false> & { eventName: string; args: Record<string, unknown> };

export const lower = (a: string) => a.toLowerCase();
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const V3_ABI = parseAbi([
  "event ClaimCreated(uint256 indexed id, address indexed creator, string category)",
  "event ClaimChallenged(uint256 indexed id, address indexed challenger, uint256 stake)",
  "event ClaimResolved(uint256 indexed id, uint8 winnerSide, string summary, uint8 confidence, bytes32 evidenceHash)",
  "event ClaimCancelled(uint256 indexed id, uint256 refunded)",
  "event ResolutionProposed(uint256 indexed id, uint8 winnerSide, uint8 confidence, bytes32 evidenceHash, uint256 disputableUntil)",
  "event ResolutionDisputed(uint256 indexed id, address indexed disputer, uint256 bond)",
  "event DisputeResolved(uint256 indexed id, uint8 winnerSide, bool disputerRight)",
  "event MarketSettled(uint256 indexed id, uint256 totalPaid, uint256 totalFees)",
  "event ClaimExpiredRefund(uint256 indexed id, address indexed caller)",
  "event ReferrerSet(uint256 indexed id, address indexed participant, address indexed referrer)",
  "event FeeAccrued(uint256 indexed id, address indexed recipient, uint256 amount)",
  "event LockSet(uint256 indexed id, uint256 lockAt)",
  "function lockAt(uint256) view returns (uint256)",
  "function settlementCutoff(uint256) view returns (uint256)",
  "function eligibleTotals(uint256) view returns (uint256 a, uint256 b)",
  "event SettlementCutoffSet(uint256 indexed id, uint256 cutoff)",
  "function getClaim(uint256) view returns (address creator, string question, string creatorPosition, string counterPosition, string resolutionUrl, uint256 creatorStake, uint256 totalChallengerStake, uint256 reservedCreatorLiability, uint256 deadline, uint8 state, uint8 winnerSide, string resolutionSummary, uint8 confidence, string category, uint256 parentId, uint256 challengerCount, uint256 createdAt, bytes32 evidenceHash)",
  "function getClaimMarketConfig(uint256) view returns (string marketType, string oddsMode, uint256 challengerPayoutBps, string handicapLine, string settlementRule, uint256 maxChallengers, bool isPrivate, uint256 reservedCreatorLiability)",
  "function getChallengerList(uint256) view returns (address[] addrs, uint256[] stakes)",
  "function disputeWindow() view returns (uint256)",
  "function proposals(uint256) view returns (uint8 winnerSide, uint8 confidence, uint64 proposedAt, uint64 disputedAt, address disputer, uint256 bond, bytes32 evidenceHash, string summary)",
]);
export const POOL_ABI = parseAbi([
  "event MarketCreated(uint256 indexed id, address indexed creator, uint256 deadline, string category)",
  "event Staked(uint256 indexed id, address indexed user, uint8 side, uint256 amount)",
  "event ResolutionProposed(uint256 indexed id, uint8 outcome, bytes32 evidenceHash, uint256 disputableUntil)",
  "event ResolutionDisputed(uint256 indexed id, address indexed disputer, uint256 bond)",
  "event DisputeResolved(uint256 indexed id, uint8 outcome, bool disputerRight)",
  "event MarketResolved(uint256 indexed id, uint8 outcome, string summary, bytes32 evidenceHash)",
  "event MarketExpiredRefund(uint256 indexed id, address indexed caller)",
  "event Claimed(uint256 indexed id, address indexed user, uint256 paid, uint256 fee)",
  "event ReferrerSet(uint256 indexed id, address indexed user, address indexed referrer)",
  "event FeeAccrued(uint256 indexed id, address indexed recipient, uint256 amount)",
  "event LockSet(uint256 indexed id, uint256 lockAt)",
  "function lockAt(uint256) view returns (uint256)",
  "function settlementCutoff(uint256) view returns (uint256)",
  "function eligibleTotals(uint256) view returns (uint256 a, uint256 b)",
  "event SettlementCutoffSet(uint256 indexed id, uint256 cutoff)",
  "function getMarket(uint256) view returns (address creator, uint256 deadline, uint256 createdAt, uint8 state, uint8 outcome, uint256 totalA, uint256 totalB)",
  "function getMarketText(uint256) view returns (string question, string labelA, string labelB, string resolutionUrl, string category, string summary)",
  "function stakeOf(uint256, address) view returns (uint256 onA, uint256 onB)",
  "function disputeWindow() view returns (uint256)",
  "function getProposal(uint256) view returns (uint8 proposed, uint256 proposedAt, uint256 disputedAt, address disputer, uint256 bond, bytes32 evidenceHash)",
]);

/** One decoded log as an arcEvents row; its amount in index units (Base ×1e12).  */
export function eventRow(cfg: { id: MarketChain["id"]; usdc: Pick<MarketChain["usdc"], "decimals"> }, kind: Kind, log: DecodedLog) {
  const a = log.args;
  const user = (a.challenger ?? a.creator ?? a.user ?? a.participant ?? a.recipient ?? a.disputer ?? a.caller) as string | undefined;
  const amount = (a.stake ?? a.amount ?? a.paid ?? a.bond ?? a.totalPaid ?? a.refunded) as bigint | undefined;
  const side = (a.side ?? a.winnerSide ?? a.outcome) as number | undefined;
  const veto = log.eventName === "ResolutionDisputed" && lower(String(a.disputer)) === ZERO_ADDRESS;
  return {
    chain: cfg.id,
    kind,
    marketId: Number(a.id as bigint),
    name: veto ? "ResolutionVetoed" : log.eventName,
    user: user && lower(user) !== ZERO_ADDRESS ? lower(user) : undefined,
    amount: amount === undefined ? undefined : indexString(cfg, amount),
    side: side === undefined ? undefined : Number(side),
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    block: Number(log.blockNumber),
  };
}

