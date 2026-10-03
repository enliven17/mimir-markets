import { PublicKey } from "@solana/web3.js";

/**
 * Which cluster the product runs on. Browser and server both read it, so it is
 * a NEXT_PUBLIC_ variable. On mainnet nothing falls back to a devnet default:
 * a missing program id, RPC, ER endpoint or USDC mint fails loudly instead of
 * silently pointing real money at devnet.
 */
export const SOLANA_CLUSTER: "devnet" | "mainnet-beta" =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() === "mainnet-beta" ? "mainnet-beta" : "devnet";
export const IS_MAINNET = SOLANA_CLUSTER === "mainnet-beta";

/** Circle's mainnet USDC: the only mint a mainnet deploy may settle in. */
export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** `value` when set; the devnet default only off mainnet. */
function clusterValue(name: string, value: string | undefined, devnetDefault: string): string {
  const v = value?.trim();
  if (v) return v;
  if (IS_MAINNET) throw new Error(`${name} must be set when NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`);
  return devnetDefault;
}

const IS_SERVER = typeof window === "undefined";

/** Mimir program (V3: optimistic resolution + disputes + fees) */
export const MIMIR_PROGRAM_ID = new PublicKey(
  clusterValue(
    "NEXT_PUBLIC_MIMIR_PROGRAM_ID",
    process.env.NEXT_PUBLIC_MIMIR_PROGRAM_ID,
    "EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE"
  )
);

/** The pre-V3 program. Read-only history; funds were migrated out of it. */
export const LEGACY_MIMIR_PROGRAM_ID = new PublicKey(
  "J9MZfzQt2LVkdfvqvTRPhcSN41gSmGKDWNVjxUQPxSDR"
);

/**
 * A keyed RPC URL in a NEXT_PUBLIC_ variable ships its key in the browser
 * bundle. On mainnet that is refused unless the operator asserts the key is
 * origin-locked at the provider (NEXT_PUBLIC_RPC_ORIGIN_LOCKED=1).
 */
export function assertPublicRpcUrl(name: string, url: string | undefined, mainnet = IS_MAINNET, originLocked = process.env.NEXT_PUBLIC_RPC_ORIGIN_LOCKED === "1"): void {
  if (!mainnet || !url || originLocked) return;
  if (/api[-_]?key/i.test(url) || url.includes("?")) {
    throw new Error(`${name} carries a key or query string; use a server-only SOLANA_RPC / MAGICBLOCK_ER_RPC, or set NEXT_PUBLIC_RPC_ORIGIN_LOCKED=1 for an origin-locked key`);
  }
}
assertPublicRpcUrl("NEXT_PUBLIC_SOLANA_RPC", process.env.NEXT_PUBLIC_SOLANA_RPC);
assertPublicRpcUrl("NEXT_PUBLIC_MAGICBLOCK_ER_RPC", process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC);

/** Base layer RPC. The server prefers its own (possibly keyed) SOLANA_RPC; the browser only ever sees NEXT_PUBLIC_SOLANA_RPC. */
export const SOLANA_RPC = clusterValue(
  "NEXT_PUBLIC_SOLANA_RPC",
  IS_SERVER ? process.env.SOLANA_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC : process.env.NEXT_PUBLIC_SOLANA_RPC,
  "https://api.devnet.solana.com"
);

/**
 * MagicBlock Ephemeral Rollup endpoint.
 * The Magic Router (devnet-router.magicblock.app) auto-routes transactions
 * between base layer and ER; the regional endpoints hit the ER directly.
 */
export const MAGICBLOCK_ER_RPC = clusterValue(
  "NEXT_PUBLIC_MAGICBLOCK_ER_RPC",
  IS_SERVER ? process.env.MAGICBLOCK_ER_RPC || process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC : process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC,
  "https://devnet-as.magicblock.app/"
);

// Server-only values: the browser never sees them, so it keeps the defaults.
export const MAGICBLOCK_ER_WS = IS_SERVER
  ? clusterValue("MAGICBLOCK_ER_WS", process.env.MAGICBLOCK_ER_WS, "wss://devnet-as.magicblock.app/")
  : "wss://devnet-as.magicblock.app/";

/** MagicBlock ER validator identity (devnet Asia region default) */
export const ER_VALIDATOR = new PublicKey(
  IS_SERVER
    ? clusterValue("MAGICBLOCK_ER_VALIDATOR", process.env.MAGICBLOCK_ER_VALIDATOR, "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57")
    : "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"
);

/** SPL mint used as USDC (6 decimals). Devnet: Circle's devnet USDC; mainnet: Circle's USDC only (and the default). */
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_SOLANA_USDC_MINT?.trim() ||
    process.env.SOLANA_USDC_MINT?.trim() ||
    (IS_MAINNET ? MAINNET_USDC_MINT : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU") // Circle devnet USDC
);
if (IS_MAINNET && USDC_MINT.toBase58() !== MAINNET_USDC_MINT) {
  throw new Error(`USDC mint ${USDC_MINT.toBase58()} is not Circle mainnet USDC`);
}

/** Explorer link for a transaction signature or an address on the active cluster. */
export function explorerUrl(kind: "tx" | "address", id: string): string {
  return `https://explorer.solana.com/${kind}/${id}${IS_MAINNET ? "" : "?cluster=devnet"}`;
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
