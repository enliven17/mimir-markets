/**
 * Mimir's Arc markets from the app's side: the calls a passkey account sends
 * (create, stake, challenge) and the payout quotes the stake UI shows. Pure
 * and isomorphic; amounts are native USDC wei (18 dp), what msg.value spends.
 *
 * VS (MimirV3, pool odds): the creator stakes X, challengers together may
 * stake up to 5X, and the winning side takes the losing side's stake pro rata.
 * Pool (MimirPool): two-sided pari-mutuel, anyone stakes either side.
 * Fees are charged on profit only, never on a returned stake.
 */
import { encodeFunctionData, parseAbi, parseEther, type Address } from "viem";

import type { ArcCall } from "./cctp-arc";

export type ArcMarketKind = "vs" | "pool";

/** Both contracts: 2 USDC minimum stake, betting closes 60 s before the deadline. */
export const MIN_STAKE_WEI = parseEther("2");
export const LOCK_SECONDS = 60;
export const MAX_POOL_MULTIPLE = 5n;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const MIMIR_V3_ABI = parseAbi([
  "function createClaim(string question, string creatorPosition, string counterPosition, string resolutionUrl, uint256 deadline, uint256 stakeAmount, string category, uint256 parentId, string marketType, string oddsMode, uint256 challengerPayoutBps, string handicapLine, string settlementRule, uint256 maxChallengers, bool isPrivate, string inviteKey, address agentOwnerRecipient) payable returns (uint256)",
  "function challengeClaim(uint256 claimId, uint256 stakeAmount, string inviteKey, address agentOwnerRecipient) payable",
  "event ClaimCreated(uint256 indexed id, address indexed creator, string category)",
]);
export const MIMIR_POOL_ABI = parseAbi([
  "function createMarket(string question, string labelA, string labelB, string resolutionUrl, string category, uint256 deadline, uint8 side) payable returns (uint256)",
  "function stake(uint256 id, uint8 side) payable",
  "event MarketCreated(uint256 indexed id, address indexed creator, uint256 deadline, string category)",
]);

export interface NewMarket {
  kind: ArcMarketKind;
  question: string;
  /** VS: your side / the side you bet against. Pool: side A / side B. */
  labelA: string;
  labelB: string;
  resolutionUrl: string;
  category: string;
  /** Unix seconds. */
  deadline: number;
  stake: bigint;
  /** Pool only: which side your opening stake backs (1 = A, 2 = B). VS: you always back side A. */
  side?: 1 | 2;
}

export function createMarketCall(contract: Address, m: NewMarket): ArcCall {
  const data =
    m.kind === "vs"
      ? encodeFunctionData({
          abi: MIMIR_V3_ABI,
          functionName: "createClaim",
          args: [m.question, m.labelA, m.labelB, m.resolutionUrl, BigInt(m.deadline), m.stake, m.category, 0n, "binary", "pool", 0n, "", "", 0n, false, "", ZERO],
        })
      : encodeFunctionData({
          abi: MIMIR_POOL_ABI,
          functionName: "createMarket",
          args: [m.question, m.labelA, m.labelB, m.resolutionUrl, m.category, BigInt(m.deadline), m.side ?? 1],
        });
  return { to: contract, data, value: m.stake };
}

/** VS: challenge (you take side B). Pool: stake on `side`. */
export function stakeCall(contract: Address, kind: ArcMarketKind, marketId: number, stake: bigint, side: 1 | 2): ArcCall {
  const data =
    kind === "vs"
      ? encodeFunctionData({ abi: MIMIR_V3_ABI, functionName: "challengeClaim", args: [BigInt(marketId), stake, "", ZERO] })
      : encodeFunctionData({ abi: MIMIR_POOL_ABI, functionName: "stake", args: [BigInt(marketId), side] });
  return { to: contract, data, value: stake };
}

const afterFee = (stake: bigint, profit: bigint, feeBps: number) => stake + profit - (profit * BigInt(feeBps)) / 10_000n;

export interface Quote {
  /** What you put in. */
  risk: bigint;
  /** Net payout if your side wins, fee taken. */
  win: bigint;
  /** True when `win` is a ceiling (later stakes on your side can only lower it). */
  atMost: boolean;
}

/**
 * A challenger staking `stake` on a VS market. Challengers split the creator's
 * stake pro rata, so every later challenger shrinks your share: the payout now
 * is the most you can win.
 */
export function vsChallengeQuote(creatorStake: bigint, totalChallengers: bigint, stake: bigint, feeBps: number): Quote {
  const total = totalChallengers + stake;
  const profit = total === 0n ? 0n : (stake * creatorStake) / total;
  return { risk: stake, win: afterFee(stake, profit, feeBps), atMost: true };
}

/** Room left for challengers on a VS market (the 5× cap). */
export function vsRoom(creatorStake: bigint, totalChallengers: bigint): bigint {
  const cap = creatorStake * MAX_POOL_MULTIPLE;
  return cap > totalChallengers ? cap - totalChallengers : 0n;
}

/** The creator of a VS market: wins whatever challengers stake, at most 5× their own stake. */
export function vsCreatorQuote(stake: bigint, feeBps: number): Quote {
  return { risk: stake, win: afterFee(stake, stake * MAX_POOL_MULTIPLE, feeBps), atMost: true };
}

/**
 * Staking on one side of a two-sided pool, given both sides' totals: what this
 * stake would return if the market closed now. Later stakes move it both ways
 * (more on the other side raises it), so it is an estimate, not a ceiling.
 */
export function poolQuote(sideTotal: bigint, otherSide: bigint, stake: bigint, feeBps: number): Quote {
  const side = sideTotal + stake;
  const profit = side === 0n ? 0n : (stake * otherSide) / side;
  return { risk: stake, win: afterFee(stake, profit, feeBps), atMost: false };
}

/** "2.5" → wei; null for anything that is not a positive amount with at most 6 decimals. */
export function parseUsdc(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const wei = parseEther(s);
  return wei > 0n ? wei : null;
}

export const weiToUsd = (wei: bigint | string) => Number(BigInt(wei)) / 1e18;
