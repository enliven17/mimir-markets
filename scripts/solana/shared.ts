/**
 * Small helpers shared by the devnet scripts (smoke test, demo, migration).
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  transfer as splTransfer,
} from "@solana/spl-token";
import type { MimirSolanaClient } from "../../lib/solana/client";
import { USDC_MINT } from "../../lib/solana/config";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const nowSec = () => Math.floor(Date.now() / 1000);

export function explorer(sig: string, er = false): string {
  return er ? `ER tx: ${sig}` : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

/** Public devnet RPC throttles bursts; retry with backoff. */
export async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i >= tries) throw err;
      const wait = 3000 * i;
      console.warn(`  (${label} failed: ${String(err?.message ?? err).slice(0, 100)}, retry ${i}/${tries - 1} in ${wait / 1000}s)`);
      await sleep(wait);
    }
  }
}

export async function waitUntil(unixSec: number, label: string): Promise<void> {
  const ms = unixSec * 1000 - Date.now();
  if (ms <= 0) return;
  console.log(`  … waiting ${Math.ceil(ms / 1000)}s for ${label}`);
  await sleep(ms);
}

export async function usdcBalance(connection: Connection, owner: PublicKey): Promise<bigint> {
  try {
    const acc = await getAccount(connection, getAssociatedTokenAddressSync(USDC_MINT, owner, true));
    return BigInt(acc.amount.toString());
  } catch {
    return 0n;
  }
}

/** Top `to` up to `minSol` from `from`. */
export async function ensureSol(connection: Connection, from: Keypair, to: PublicKey, minSol: number): Promise<void> {
  const have = await connection.getBalance(to);
  const want = Math.round(minSol * LAMPORTS_PER_SOL);
  if (have >= want) return;
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: want - have })),
    [from]
  );
}

/** Move USDC between wallets' ATAs (creates the destination ATA if needed; `from` pays). */
export async function sendUsdc(connection: Connection, from: Keypair, to: PublicKey, units: bigint): Promise<void> {
  if (units <= 0n) return;
  const src = await getOrCreateAssociatedTokenAccount(connection, from, USDC_MINT, from.publicKey);
  const dst = await getOrCreateAssociatedTokenAccount(connection, from, USDC_MINT, to, true);
  await splTransfer(connection, from, src.address, dst.address, from, units);
}

/**
 * Run `fn` with short dispute/grace windows. Windows are frozen onto a claim
 * when it is created, so only claims created inside `fn` get the short terms;
 * the previous values are restored right after, even on failure.
 */
export async function withShortWindows<T>(
  admin: MimirSolanaClient,
  disputeWindow: number,
  resolutionGrace: number,
  fn: () => Promise<T>
): Promise<T> {
  const cfg = await admin.getConfig();
  if (!cfg) throw new Error("program not initialized");
  await admin.setWindows(disputeWindow, resolutionGrace);
  try {
    return await fn();
  } finally {
    await withRetry("restore windows", () => admin.setWindows(cfg.disputeWindow, cfg.resolutionGrace));
    console.log(`  windows restored → dispute ${cfg.disputeWindow}s, grace ${cfg.resolutionGrace}s`);
  }
}
