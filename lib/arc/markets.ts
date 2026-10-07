/**
 * Mimir's Arc markets from the app's side: the calls a passkey account sends
 * (create, stake, challenge, apply a holder ticket) and the quotes the stake
 * UI shows. Pure and isomorphic; amounts are native USDC wei (18 dp), what
 * msg.value spends.
 *
 * VS (MimirV3, pool odds): the creator stakes X, challengers together may
 * stake up to 5X, and the winning side takes the losing side's stake pro rata.
 * Pool (MimirPool): two-sided pari-mutuel, anyone stakes either side.
 * Fees (lib/arc/fee-tiers.ts): an entry fee comes off every stake (0.5%, less
 * for $MIMIR holders) and is kept on refunds; no fee on winnings, except copy
 * trades, which give 1% of the profit to the basket creator and 1% to Mimir.
 */
import { encodeFunctionData, parseAbi, parseEther, zeroAddress, type Address } from "viem";

import type { ArcCall } from "./cctp-arc";
import { ARC } from "./config";
import { COPY_FEE_BPS, REFERRER_FEE_BPS, type FeeTicket } from "./fee-tiers";

export type ArcMarketKind = "vs" | "pool";

/** Both contracts: the deploy-time minimum (gross) stake, betting closes 60 s before the deadline. */
export const MIN_STAKE_WEI = ARC.contracts.minStakeWei;
export const LOCK_SECONDS = 60;
export const MAX_POOL_MULTIPLE = 5n;

export const MIMIR_V3_ABI = parseAbi([
  "function createClaim(string question, string creatorPosition, string counterPosition, string resolutionUrl, uint256 deadline, uint256 stakeAmount, string category, uint256 parentId, string marketType, string oddsMode, uint256 challengerPayoutBps, string handicapLine, string settlementRule, uint256 maxChallengers, bool isPrivate, string inviteKey, address referrer) payable returns (uint256)",
  "function challengeClaim(uint256 claimId, uint256 stakeAmount, string inviteKey, address referrer) payable",
  "function cancelClaim(uint256 claimId)",
  "function disputeResolution(uint256 claimId) payable",
  "event ClaimCreated(uint256 indexed id, address indexed creator, string category)",
]);
export const MIMIR_POOL_ABI = parseAbi([
  "function createMarket(string question, string labelA, string labelB, string resolutionUrl, string category, uint256 deadline, uint8 side, address referrer) payable returns (uint256)",
  "function stake(uint256 id, uint8 side, address referrer) payable",
  "function dispute(uint256 id) payable",
  "event MarketCreated(uint256 indexed id, address indexed creator, uint256 deadline, string category)",
]);
export const MIMIR_FEES_ABI = parseAbi([
  "function applyTicket(uint8 tier, uint64 expires, bytes sig)",
  "function entryBps(address account) view returns (uint16)",
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
  /** Gross: what leaves the account; the entry fee comes off it. */
  stake: bigint;
  /** Pool only: which side your opening stake backs (1 = A, 2 = B). VS: you always back side A. */
  side?: 1 | 2;
  /** The basket creator, when this is a copy trade. */
  referrer?: Address;
}

export function createMarketCall(contract: Address, m: NewMarket): ArcCall {
  const referrer = m.referrer ?? zeroAddress;
  const data =
    m.kind === "vs"
      ? encodeFunctionData({
          abi: MIMIR_V3_ABI,
          functionName: "createClaim",
          args: [m.question, m.labelA, m.labelB, m.resolutionUrl, BigInt(m.deadline), m.stake, m.category, 0n, "binary", "pool", 0n, "", "", 0n, false, "", referrer],
        })
      : encodeFunctionData({
          abi: MIMIR_POOL_ABI,
          functionName: "createMarket",
          args: [m.question, m.labelA, m.labelB, m.resolutionUrl, m.category, BigInt(m.deadline), m.side ?? 1, referrer],
        });
  return { to: contract, data, value: m.stake };
}

/** VS: challenge (you take side B). Pool: stake on `side`. `stake` is gross. */
export function stakeCall(contract: Address, kind: ArcMarketKind, marketId: number, stake: bigint, side: 1 | 2, referrer: Address = zeroAddress): ArcCall {
  const data =
    kind === "vs"
      ? encodeFunctionData({ abi: MIMIR_V3_ABI, functionName: "challengeClaim", args: [BigInt(marketId), stake, "", referrer] })
      : encodeFunctionData({ abi: MIMIR_POOL_ABI, functionName: "stake", args: [BigInt(marketId), side, referrer] });
  return { to: contract, data, value: stake };
}

/** The holder ticket as a call, sent in the same user operation as the bet; null when there is nothing to apply. */
export function applyTicketCall(fees: Address, t: FeeTicket): ArcCall | null {
  if (!t.signature || t.tier === 0) return null;
  return { to: fees, data: encodeFunctionData({ abi: MIMIR_FEES_ABI, functionName: "applyTicket", args: [t.tier, BigInt(t.expires), t.signature] }) };
}

export const entryFeeOf = (gross: bigint, entryBps: number) => (gross * BigInt(entryBps)) / 10_000n;
const copyFees = (profit: bigint, copy: boolean) => (copy ? (profit * BigInt(REFERRER_FEE_BPS + COPY_FEE_BPS)) / 10_000n : 0n);

export interface Quote {
  /** What leaves your account. */
  risk: bigint;
  /** The entry fee in it (kept even on a refund). */
  fee: bigint;
  /** Net payout if your side wins. */
  win: bigint;
  /** True when `win` is a ceiling (later stakes on your side can only lower it). */
  atMost: boolean;
}

/**
 * A challenger sending `gross` to a VS market (stakes are net of their entry
 * fee). Challengers split the creator's stake pro rata, so every later
 * challenger shrinks your share: the payout now is the most you can win.
 */
export function vsChallengeQuote(creatorStake: bigint, totalChallengers: bigint, gross: bigint, entryBps: number, copy = false): Quote {
  const fee = entryFeeOf(gross, entryBps);
  const net = gross - fee;
  // The creator risks at most 5x what challengers put in (MimirV3 _settle), so a lone small challenger wins 5x, not the pot.
  const pool = totalChallengers + net;
  const atRisk = creatorStake < pool * MAX_POOL_MULTIPLE ? creatorStake : pool * MAX_POOL_MULTIPLE;
  const profit = pool === 0n ? 0n : (net * atRisk) / pool;
  return { risk: gross, fee, win: net + profit - copyFees(profit, copy), atMost: true };
}

/** Net stake still allowed from challengers (the 5x cap on the creator's net stake). */
export function vsRoom(creatorStake: bigint, totalChallengers: bigint): bigint {
  const cap = creatorStake * MAX_POOL_MULTIPLE;
  return cap > totalChallengers ? cap - totalChallengers : 0n;
}

/** The largest gross amount whose net fits in `room`. */
export const maxGrossFor = (room: bigint, entryBps: number) => (room * 10_000n) / BigInt(10_000 - entryBps);

/** The creator of a VS market: wins whatever challengers stake, at most 5x their own net stake. */
export function vsCreatorQuote(gross: bigint, entryBps: number, copy = false): Quote {
  const fee = entryFeeOf(gross, entryBps);
  const net = gross - fee;
  const profit = net * MAX_POOL_MULTIPLE;
  return { risk: gross, fee, win: net + profit - copyFees(profit, copy), atMost: true };
}

/**
 * Sending `gross` to one side of a two-sided pool, given both sides' totals:
 * what it would return if the market closed now. Later stakes move it both
 * ways (more on the other side raises it), so it is an estimate, not a ceiling.
 */
export function poolQuote(sideTotal: bigint, otherSide: bigint, gross: bigint, entryBps: number, copy = false): Quote {
  const fee = entryFeeOf(gross, entryBps);
  const net = gross - fee;
  const profit = sideTotal + net === 0n ? 0n : (net * otherSide) / (sideTotal + net);
  return { risk: gross, fee, win: net + profit - copyFees(profit, copy), atMost: false };
}

/** "2.5" → wei; null for anything that is not a positive amount with at most 6 decimals. */
export function parseUsdc(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const wei = parseEther(s);
  return wei > 0n ? wei : null;
}

export const weiToUsd = (wei: bigint | string) => Number(BigInt(wei)) / 1e18;
