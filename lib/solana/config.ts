import { PublicKey } from "@solana/web3.js";
import { deployment, assertDevnetEnv } from "../../config/solana-devnet.cjs";

const IS_SERVER = typeof window === "undefined";
assertDevnetEnv(IS_SERVER ? process.env : {
  NEXT_PUBLIC_SOLANA_CLUSTER: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
  NEXT_PUBLIC_MIMIR_PROGRAM_ID: process.env.NEXT_PUBLIC_MIMIR_PROGRAM_ID,
  NEXT_PUBLIC_SOLANA_USDC_MINT: process.env.NEXT_PUBLIC_SOLANA_USDC_MINT,
  NEXT_PUBLIC_SOLANA_RPC: process.env.NEXT_PUBLIC_SOLANA_RPC,
  NEXT_PUBLIC_MAGICBLOCK_ER_RPC: process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_MIMIR_TOKEN_MINT: process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT,
});

export const SOLANA_CLUSTER = deployment.cluster;
// Compatibility for the shared decision policies. This deployment is always devnet.
export const IS_MAINNET: boolean = false;
export const MIMIR_PROGRAM_ID = new PublicKey(deployment.programId);
export const USDC_MINT = new PublicKey(deployment.usdcMint);
export const LEGACY_MIMIR_PROGRAM_ID = new PublicKey("J9MZfzQt2LVkdfvqvTRPhcSN41gSmGKDWNVjxUQPxSDR");

export const SOLANA_RPC = (IS_SERVER ? process.env.SOLANA_RPC : undefined)?.trim() ||
  process.env.NEXT_PUBLIC_SOLANA_RPC?.trim() || deployment.rpc;
export const MAGICBLOCK_ER_RPC = deployment.erRpc;
export const MAGICBLOCK_ER_WS = deployment.erWs;
export const ER_VALIDATOR = new PublicKey(deployment.erValidator);

/** Do not publish an unrestricted provider key in a browser bundle. */
export function assertPublicRpcUrl(name: string, url: string | undefined, _mainnet = false, originLocked = process.env.NEXT_PUBLIC_RPC_ORIGIN_LOCKED === "1"): void {
  if (url && !originLocked && (/api[-_]?key/i.test(url) || url.includes("?"))) {
    throw new Error(`${name} needs an origin-locked public key or a keyless devnet RPC`);
  }
}
assertPublicRpcUrl("NEXT_PUBLIC_SOLANA_RPC", process.env.NEXT_PUBLIC_SOLANA_RPC);

export function explorerUrl(kind: "tx" | "address", id: string): string {
  return `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
}

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
  // DataView, not Buffer#writeBigUInt64LE: wallet in-app browsers can swap
  // window.Buffer for an old polyfill without the BigInt methods.
  const idBuf = new Uint8Array(8);
  new DataView(idBuf.buffer).setBigUint64(0, BigInt(claimId), true);
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
