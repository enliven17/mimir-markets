/**
 * Mimir's fees on Arc (docs/ARC.md). Every on-chain entry (opening a market, a
 * bet, an agent's bet) pays an entry fee taken from the stake; $MIMIR holders
 * pay less, proven by a ticket the server signs from their bound Solana
 * wallet's balance (contracts/MimirFees.sol checks it). Copy bets add 1% of
 * the profit to the basket creator and 1% to Mimir, on wins only. Deploying
 * an agent costs a flat USDC price by the same tiers.
 *
 * Pure and isomorphic: the tier table, the quote math and the EIP-712 shape
 * the server signs and the contract verifies.
 */
import type { Address } from "viem";

/** 0 = everyone, 1 = 5M+ $MIMIR, 2 = 10M+ $MIMIR. Must match MimirFees.sol. */
export type FeeTier = 0 | 1 | 2;

export const ENTRY_FEE_BPS: Record<FeeTier, number> = { 0: 50, 1: 25, 2: 10 };
/** Agent deploy price in USDC. */
export const AGENT_DEPLOY_USD: Record<FeeTier, number> = { 0: 1, 1: 0.5, 2: 0 };
/** Copy bets: share of the profit to the basket creator, and to Mimir. */
export const REFERRER_FEE_BPS = 100;
export const COPY_FEE_BPS = 100;
/** A ticket is good for 24 hours (the contract refuses more than 2 days). */
export const TICKET_TTL_SECONDS = 24 * 3600;

export const FEE_TIER_LABEL: Record<FeeTier, string> = { 0: "Standard", 1: "5M+ $MIMIR", 2: "10M+ $MIMIR" };

export interface FeeTierThresholds {
  holder: number;
  whale: number;
}

export function feeTierThresholds(env: Record<string, string | undefined> = process.env): FeeTierThresholds {
  const n = (k: string, d: number) => {
    const v = Number(env[k]?.trim());
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return { holder: n("MIMIR_FEE_HOLDER_MIN", 5_000_000), whale: n("MIMIR_FEE_WHALE_MIN", 10_000_000) };
}

export function feeTierFor(mimir: number, t: FeeTierThresholds = feeTierThresholds()): FeeTier {
  if (mimir >= t.whale) return 2;
  if (mimir >= t.holder) return 1;
  return 0;
}

/** The entry fee on a gross stake (wei), rounded down like the contract. */
export const entryFee = (gross: bigint, tier: FeeTier) => (gross * BigInt(ENTRY_FEE_BPS[tier])) / 10_000n;

export const FEE_TICKET_TYPES = {
  FeeTicket: [
    { name: "account", type: "address" },
    { name: "tier", type: "uint8" },
    { name: "expires", type: "uint64" },
  ],
} as const;

export function feeTicketDomain(chainId: number, verifyingContract: Address) {
  return { name: "Mimir Fees", version: "1", chainId, verifyingContract } as const;
}

export interface FeeTicket {
  account: Address;
  tier: FeeTier;
  /** Unix seconds. */
  expires: number;
  /** The server's EIP-712 signature; null for tier 0 (nothing to prove). */
  signature: `0x${string}` | null;
}
