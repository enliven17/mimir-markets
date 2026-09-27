import { PublicKey } from "@solana/web3.js";

/** Mimir program on Solana devnet (V3: optimistic resolution + disputes + fees) */
export const MIMIR_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_MIMIR_PROGRAM_ID ||
    "EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE"
);

/** The pre-V3 program. Read-only history; funds were migrated out of it. */
export const LEGACY_MIMIR_PROGRAM_ID = new PublicKey(
  "J9MZfzQt2LVkdfvqvTRPhcSN41gSmGKDWNVjxUQPxSDR"
);

/** Base layer (Solana devnet) RPC */
export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  process.env.SOLANA_RPC ||
  "https://api.devnet.solana.com";

/**
 * MagicBlock Ephemeral Rollup endpoint.
 * The Magic Router (devnet-router.magicblock.app) auto-routes transactions
 * between base layer and ER; the regional endpoints hit the ER directly.
 */
export const MAGICBLOCK_ER_RPC =
  process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC ||
  process.env.MAGICBLOCK_ER_RPC ||
  "https://devnet-as.magicblock.app/";

export const MAGICBLOCK_ER_WS =
  process.env.MAGICBLOCK_ER_WS || "wss://devnet-as.magicblock.app/";

/** MagicBlock devnet ER validator identity (Asia region default) */
export const ER_VALIDATOR = new PublicKey(
  process.env.MAGICBLOCK_ER_VALIDATOR ||
    "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"
);

/** SPL mint used as USDC (6 decimals). Devnet: our test mint or Circle's devnet USDC. */
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_SOLANA_USDC_MINT ||
    process.env.SOLANA_USDC_MINT ||
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // Circle devnet USDC
);

export const USDC_DECIMALS = 6;

/** Convert a UI amount (e.g. 2.5) to base units (6 dp) */
export function toUsdcUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}

export function fromUsdcUnits(units: bigint | number): number {
  return Number(units) / 10 ** USDC_DECIMALS;
}

// ── PDA helpers ────────────────────────────────────────────────────────────

export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    MIMIR_PROGRAM_ID
  )[0];
}

export function vaultPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    MIMIR_PROGRAM_ID
  )[0];
}

export function balancePda(user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("balance"), user.toBuffer()],
    MIMIR_PROGRAM_ID
  )[0];
}

export function claimPda(claimId: bigint | number): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(claimId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), idBuf],
    MIMIR_PROGRAM_ID
  )[0];
}

/** Agent-owner fee accrual PDA for one recipient. */
export function feeBalancePda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fees"), owner.toBuffer()],
    MIMIR_PROGRAM_ID
  )[0];
}

// ── Claim states (mirror of on-chain constants, MimirV3 numbering) ────────

export const ST_OPEN = 0;
export const ST_ACTIVE = 1;
export const ST_RESOLVED = 2;
export const ST_CANCELLED = 3;
/** Oracle proposed a verdict; disputable until `disputableUntil`. */
export const ST_PROPOSED = 4;
/** A participant posted a bond to dispute; the admin (arbiter) decides. */
export const ST_DISPUTED = 5;

export const STATE_LABELS = ["OPEN", "ACTIVE", "RESOLVED", "CANCELLED", "PROPOSED", "DISPUTED"] as const;

/** Claim still takes (or holds) positions: not proposed, settled or cancelled. */
export function isLiveState(state: number): boolean {
  return state === ST_OPEN || state === ST_ACTIVE;
}

/** A verdict is in, final or not (PROPOSED / DISPUTED / RESOLVED). */
export function isSettlingState(state: number): boolean {
  return state === ST_PROPOSED || state === ST_DISPUTED || state === ST_RESOLVED;
}

export const SIDE_NONE = 0;
export const SIDE_CREATOR = 1;
export const SIDE_CHALLENGERS = 2;
export const SIDE_DRAW = 3;
export const SIDE_UNRESOLVABLE = 4;

// Dispute bond lifecycle
export const BOND_NONE = 0;
export const BOND_HELD = 1;
export const BOND_REFUND_DUE = 2;
export const BOND_REFUNDED = 3;
export const BOND_FORFEITED = 4;

/** Bond a participant posts (from their USDC token account) to dispute a proposal. */
export const DISPUTE_BOND_UNITS = 2_000_000n;
/** Minimum stake, 2 USDC. */
export const MIN_STAKE_UNITS = 2_000_000n;
/** No fee policy may take more than 10% of a winner's profit. */
export const MAX_TOTAL_FEE_BPS = 1_000;
