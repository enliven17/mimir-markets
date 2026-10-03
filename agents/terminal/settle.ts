/**
 * Mimir Terminal settlement, inside the workers process (agents/all.ts).
 *
 * Every TERMINAL_SETTLE_INTERVAL_MS: paid-message charges are batched per
 * (user wallet, agent payout wallet) and moved in one transaction signed by
 * the terminal delegate, which spends only within the limit the user approved:
 *   agent share → the agent's payout wallet, TERMINAL_FEE_BPS → TERMINAL_FEE_RECIPIENT.
 *
 * Exactly-once:
 *   - one settler at a time (a Postgres advisory lock held for the cycle);
 *   - rows move pending → settling only if still pending, with the signature
 *     and the transaction's last valid block height stored before sending;
 *   - a settling row whose transaction the chain has not seen is re-queued
 *     only once the chain is past that height, when it can no longer land.
 * A batch is cut to what the user's limit and balance cover right now.
 * Failed batches (limit revoked, no balance) are retried later and keep
 * counting against the wallet; the operator hears about each one once.
 *
 * Needs TERMINAL_DELEGATE_KEYPAIR_JSON (its public key = NEXT_PUBLIC_TERMINAL_DELEGATE),
 * TERMINAL_FEE_RECIPIENT and DATABASE_URL; without them it stays off.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";

import { alert } from "../oracle/alert";
import { getDb, isDbEnabled, query } from "../../lib/server/db";
import { readAllowance } from "../../lib/server/terminal-pay";
import { SOLANA_RPC, USDC_DECIMALS, USDC_MINT } from "../../lib/solana/config";
import { splitCharge } from "../../lib/terminal/pay";

const INTERVAL_MS = Number(process.env.TERMINAL_SETTLE_INTERVAL_MS ?? "30000");
const RETRY_FAILED_MS = 10 * 60_000;
const STALE_RESERVED_MS = 5 * 60_000;
const MAX_GROUPS = 20;
/** Small batches wait until they are worth a transaction fee: 0.01 USDC, or an hour old. */
export const MIN_SETTLE_UNITS = 10_000n;
export const MAX_WAIT_MS = 60 * 60_000;
const LOW_SOL = 0.01 * LAMPORTS_PER_SOL;
const LOCK_KEY = "terminal-settle";

export interface ChargeRow {
  id: number;
  wallet: string;
  payout_wallet: string;
  amount_units: string;
  status: string;
  created_at: string;
}

export interface ChargeGroup {
  wallet: string;
  payoutWallet: string;
  rows: { id: number; units: bigint; status: string }[];
  totalUnits: bigint;
  oldestMs: number;
}

/** Charges batched per (payer, payee), largest first. Pure. */
export function groupCharges(rows: ChargeRow[], max = MAX_GROUPS): ChargeGroup[] {
  const groups = new Map<string, ChargeGroup>();
  for (const r of rows) {
    const key = `${r.wallet}:${r.payout_wallet}`;
    const g = groups.get(key) ?? { wallet: r.wallet, payoutWallet: r.payout_wallet, rows: [], totalUnits: 0n, oldestMs: Infinity };
    g.rows.push({ id: Number(r.id), units: BigInt(r.amount_units), status: r.status });
    g.totalUnits += BigInt(r.amount_units);
    g.oldestMs = Math.min(g.oldestMs, Number(r.created_at));
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (b.totalUnits > a.totalUnits ? 1 : b.totalUnits < a.totalUnits ? -1 : 0)).slice(0, max);
}

/** Is a batch worth settling now? Pure. */
export function readyToSettle(g: Pick<ChargeGroup, "totalUnits" | "oldestMs">, now = Date.now()): boolean {
  return g.totalUnits >= MIN_SETTLE_UNITS || now - g.oldestMs >= MAX_WAIT_MS;
}

/** The oldest charges that fit in `room`, in order: a limit cut short settles what it can. Pure. */
export function fitToRoom<T extends { units: bigint }>(rows: T[], room: bigint): T[] {
  const out: T[] = [];
  let used = 0n;
  for (const r of rows) {
    if (used + r.units > room) break;
    used += r.units;
    out.push(r);
  }
  return out;
}

function loadDelegate(): Keypair | null {
  const raw = process.env.TERMINAL_DELEGATE_KEYPAIR_JSON?.trim();
  if (!raw) return null;
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : Uint8Array.from(Buffer.from(raw, "base64"));
  return Keypair.fromSecretKey(bytes);
}

async function setStatus(ids: number[], status: string, extra: { error?: string | null } = {}) {
  await query(`UPDATE terminal_charges SET status = $2, error = $3, updated_at = $4 WHERE id = ANY($1::bigint[])`, [
    ids, status, extra.error ?? null, Date.now(),
  ]);
}

/** Settling rows whose outcome is not recorded: the chain decides, and a lost transaction is re-queued only once it is dead. */
async function resolveSettling(conn: Connection): Promise<void> {
  const rows = await query<{ signature: string; ids: string[]; height: string | null }>(
    `SELECT signature, array_agg(id::text) AS ids, MAX(valid_until_height)::text AS height
       FROM terminal_charges WHERE status = 'settling' AND signature IS NOT NULL GROUP BY signature LIMIT 50`,
  );
  if (rows.length === 0) return;
  const [statuses, height] = await Promise.all([
    conn.getSignatureStatuses(rows.map((r) => r.signature), { searchTransactionHistory: true }),
    conn.getBlockHeight("confirmed"),
  ]);
  for (const [i, r] of rows.entries()) {
    const st = statuses.value[i];
    const ids = r.ids.map(Number);
    if (st?.err) await setStatus(ids, "failed", { error: `on-chain error: ${JSON.stringify(st.err)}` });
    else if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") await setStatus(ids, "paid");
    else if (!st && r.height !== null && height > Number(r.height)) await setStatus(ids, "pending", { error: "expired before landing, retrying" });
  }
}

async function settleGroup(conn: Connection, delegate: Keypair, feeRecipient: PublicKey, g: ChargeGroup): Promise<void> {
  const owner = new PublicKey(g.wallet);
  const payee = new PublicKey(g.payoutWallet);
  const firstFailure = g.rows.some((r) => r.status === "pending");
  const fail = async (ids: number[], msg: string) => {
    await setStatus(ids, "failed", { error: msg });
    if (firstFailure) await alert(`Terminal charge failed for ${g.wallet}: ${Number(g.totalUnits) / 1e6} USDC to ${g.payoutWallet} (${msg})`);
  };

  // The payee's USDC account must exist: opening it from the delegate would let anyone spend our SOL on rent.
  const payeeAta = getAssociatedTokenAddressSync(USDC_MINT, payee, true);
  if (!(await conn.getAccountInfo(payeeAta, "confirmed"))) {
    await setStatus(g.rows.map((r) => r.id), g.rows[0].status, { error: "the agent's payout wallet has no USDC account yet" });
    return;
  }

  // Cut the batch to what the user's limit and balance cover right now.
  const allowance = await readAllowance(g.wallet);
  const room = allowance.delegate === delegate.publicKey.toBase58()
    ? (allowance.delegatedUnits < allowance.balanceUnits ? allowance.delegatedUnits : allowance.balanceUnits)
    : 0n;
  const batch = fitToRoom(g.rows, room);
  if (batch.length === 0) return fail(g.rows.map((r) => r.id), room === 0n ? "no spending limit or balance left" : "limit too low for the next charge");
  const ids = batch.map((r) => r.id);
  const total = batch.reduce((s, r) => s + r.units, 0n);
  const { agentUnits, feeUnits } = splitCharge(total);

  const source = getAssociatedTokenAddressSync(USDC_MINT, owner, true);
  const feeAta = getAssociatedTokenAddressSync(USDC_MINT, feeRecipient, true);
  const tx = new Transaction();
  tx.add(createTransferCheckedInstruction(source, USDC_MINT, payeeAta, delegate.publicKey, agentUnits, USDC_DECIMALS));
  if (feeUnits > 0n) {
    // Mimir's own fee account: opened once, then a no-op.
    tx.add(createAssociatedTokenAccountIdempotentInstruction(delegate.publicKey, feeAta, feeRecipient, USDC_MINT));
    tx.add(createTransferCheckedInstruction(source, USDC_MINT, feeAta, delegate.publicKey, feeUnits, USDC_DECIMALS));
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = delegate.publicKey;
  tx.sign(delegate);
  const signature = bs58.encode(tx.signature!);

  // Claim the rows (only if still unclaimed) and record the signature before anything is sent.
  const claimed = await query(
    `UPDATE terminal_charges SET status = 'settling', signature = $2, valid_until_height = $3, error = NULL, updated_at = $4
      WHERE id = ANY($1::bigint[]) AND status IN ('pending', 'failed') RETURNING id`,
    [ids, signature, lastValidBlockHeight, Date.now()],
  );
  if (claimed.length !== ids.length) {
    // Another settler got some of them: put back the ones we took and leave the rest to it.
    if (claimed.length) await setStatus(claimed.map((r) => Number((r as { id: string }).id)), "pending", { error: null });
    return;
  }
  try {
    await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`on-chain error: ${JSON.stringify(res.value.err)}`);
    await setStatus(ids, "paid");
    console.log(`[terminal] ✓ settled ${Number(total) / 1e6} USDC from ${g.wallet.slice(0, 4)}… (${ids.length} message(s))`);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
    // A preflight rejection never landed: failed (retried later). Anything else: the chain decides (resolveSettling).
    if (/simulation|insufficient|owner does not match|0x1\b|0x4\b/i.test(msg)) await fail(ids, msg);
    else console.warn(`[terminal] settle ${g.wallet.slice(0, 4)}… unconfirmed, the chain will decide:`, msg);
  }
}

let lowSolAlertedAt = 0;

async function cycle(conn: Connection, delegate: Keypair, feeRecipient: PublicKey): Promise<void> {
  const now = Date.now();
  await query("DELETE FROM terminal_charges WHERE status = 'reserved' AND updated_at < $1", [now - STALE_RESERVED_MS]);
  await resolveSettling(conn);

  const lamports = await conn.getBalance(delegate.publicKey, "confirmed");
  if (lamports < LOW_SOL) {
    if (now - lowSolAlertedAt > 60 * 60_000) {
      lowSolAlertedAt = now;
      await alert(`Terminal delegate ${delegate.publicKey.toBase58()} is low on SOL (${lamports / LAMPORTS_PER_SOL}): settlement paused`);
    }
    return;
  }

  const rows = await query<ChargeRow>(
    `SELECT id, wallet, payout_wallet, amount_units::text AS amount_units, status, created_at::text AS created_at
       FROM terminal_charges
      WHERE status = 'pending' OR (status = 'failed' AND updated_at < $1)
      ORDER BY id LIMIT 500`,
    [now - RETRY_FAILED_MS],
  );
  for (const g of groupCharges(rows)) {
    if (!readyToSettle(g, now)) continue;
    await settleGroup(conn, delegate, feeRecipient, g).catch((err) => console.warn("[terminal] settle error:", err?.message ?? err));
  }
}

/** One settler at a time across processes: a session advisory lock held for the cycle. */
async function lockedCycle(conn: Connection, delegate: Keypair, feeRecipient: PublicKey): Promise<void> {
  const pool = await getDb();
  const client = await pool.connect();
  try {
    const got = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [LOCK_KEY]);
    if (!got.rows[0]?.ok) return;
    try {
      await cycle(conn, delegate, feeRecipient);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const delegate = loadDelegate();
  const feeRaw = process.env.TERMINAL_FEE_RECIPIENT?.trim();
  if (!delegate || !feeRaw || !isDbEnabled()) {
    console.log("[terminal] settlement off (needs TERMINAL_DELEGATE_KEYPAIR_JSON, TERMINAL_FEE_RECIPIENT, DATABASE_URL).");
    return;
  }
  const expected = process.env.NEXT_PUBLIC_TERMINAL_DELEGATE?.trim();
  if (expected !== delegate.publicKey.toBase58()) {
    console.error("[terminal] TERMINAL_DELEGATE_KEYPAIR_JSON does not match NEXT_PUBLIC_TERMINAL_DELEGATE: settlement off.");
    return;
  }
  const feeRecipient = new PublicKey(feeRaw);
  const conn = new Connection(SOLANA_RPC, "confirmed");
  console.log(`[terminal] settlement on: delegate ${delegate.publicKey.toBase58()}, fees to ${feeRecipient.toBase58()}`);
  for (;;) {
    await lockedCycle(conn, delegate, feeRecipient).catch((err) => console.warn("[terminal] cycle failed:", err?.message ?? err));
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

// Not on import from tests.
if (process.env.NODE_TEST_CONTEXT === undefined) main().catch((err) => console.error("[terminal] stopped:", err));
