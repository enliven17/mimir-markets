/**
 * Mimir Terminal settlement, inside the workers process (agents/all.ts).
 *
 * Every TERMINAL_SETTLE_INTERVAL_MS: paid-message charges are batched per
 * (user wallet, agent payout wallet) and moved in one transaction signed by
 * the terminal delegate, which spends only within the limit the user approved:
 *   agent share → the agent's payout wallet, TERMINAL_FEE_BPS → TERMINAL_FEE_RECIPIENT.
 *
 * Exactly-once: the signature is stored (status settling) before the
 * transaction is sent, and a settling row is resolved from the chain, so a
 * crash mid-send never charges twice. Failed batches (limit revoked, no
 * balance) are retried later and keep counting against the wallet until paid.
 *
 * Needs TERMINAL_DELEGATE_KEYPAIR_JSON (its public key = NEXT_PUBLIC_TERMINAL_DELEGATE),
 * TERMINAL_FEE_RECIPIENT and DATABASE_URL; without them it stays off.
 */
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";

import { alert } from "../oracle/alert";
import { isDbEnabled, query } from "../../lib/server/db";
import { SOLANA_RPC, USDC_DECIMALS, USDC_MINT } from "../../lib/solana/config";
import { splitCharge } from "../../lib/terminal/pay";

const INTERVAL_MS = Number(process.env.TERMINAL_SETTLE_INTERVAL_MS ?? "30000");
const RETRY_FAILED_MS = 10 * 60_000;
const STALE_RESERVED_MS = 5 * 60_000;
const SETTLING_TIMEOUT_MS = 3 * 60_000;
const MAX_GROUPS = 20;

export interface ChargeRow {
  id: number;
  wallet: string;
  payout_wallet: string;
  amount_units: string;
}

export interface ChargeGroup {
  wallet: string;
  payoutWallet: string;
  ids: number[];
  totalUnits: bigint;
}

/** Charges batched per (payer, payee), largest first. Pure. */
export function groupCharges(rows: ChargeRow[], max = MAX_GROUPS): ChargeGroup[] {
  const groups = new Map<string, ChargeGroup>();
  for (const r of rows) {
    const key = `${r.wallet}:${r.payout_wallet}`;
    const g = groups.get(key) ?? { wallet: r.wallet, payoutWallet: r.payout_wallet, ids: [], totalUnits: 0n };
    g.ids.push(Number(r.id));
    g.totalUnits += BigInt(r.amount_units);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (b.totalUnits > a.totalUnits ? 1 : b.totalUnits < a.totalUnits ? -1 : 0)).slice(0, max);
}

function loadDelegate(): Keypair | null {
  const raw = process.env.TERMINAL_DELEGATE_KEYPAIR_JSON?.trim();
  if (!raw) return null;
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : Uint8Array.from(Buffer.from(raw, "base64"));
  return Keypair.fromSecretKey(bytes);
}

async function setStatus(ids: number[], status: string, extra: { signature?: string | null; error?: string | null } = {}) {
  await query(
    `UPDATE terminal_charges SET status = $2, signature = COALESCE($3, signature), error = $4, updated_at = $5 WHERE id = ANY($1::bigint[])`,
    [ids, status, extra.signature ?? null, extra.error ?? null, Date.now()],
  );
}

/** Settling rows whose transaction outcome we have not recorded: read it from the chain. */
async function resolveSettling(conn: Connection): Promise<void> {
  const rows = await query<{ signature: string; ids: string[]; updated_at: string }>(
    `SELECT signature, array_agg(id::text) AS ids, MIN(updated_at)::text AS updated_at
       FROM terminal_charges WHERE status = 'settling' AND signature IS NOT NULL GROUP BY signature LIMIT 50`,
  );
  if (rows.length === 0) return;
  const statuses = await conn.getSignatureStatuses(rows.map((r) => r.signature), { searchTransactionHistory: true });
  for (const [i, r] of rows.entries()) {
    const st = statuses.value[i];
    const ids = r.ids.map(Number);
    if (st?.err) await setStatus(ids, "failed", { error: `on-chain error: ${JSON.stringify(st.err)}` });
    else if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") await setStatus(ids, "paid");
    // Never landed and its blockhash is long gone: owed again.
    else if (Date.now() - Number(r.updated_at) > SETTLING_TIMEOUT_MS) await setStatus(ids, "pending", { error: "not landed, retrying" });
  }
}

async function settleGroup(conn: Connection, delegate: Keypair, feeRecipient: PublicKey, g: ChargeGroup): Promise<void> {
  const owner = new PublicKey(g.wallet);
  const payee = new PublicKey(g.payoutWallet);
  const source = getAssociatedTokenAddressSync(USDC_MINT, owner, true);
  const payeeAta = getAssociatedTokenAddressSync(USDC_MINT, payee, true);
  const feeAta = getAssociatedTokenAddressSync(USDC_MINT, feeRecipient, true);
  const { agentUnits, feeUnits } = splitCharge(g.totalUnits);

  const tx = new Transaction();
  tx.add(createAssociatedTokenAccountIdempotentInstruction(delegate.publicKey, payeeAta, payee, USDC_MINT));
  tx.add(createTransferCheckedInstruction(source, USDC_MINT, payeeAta, delegate.publicKey, agentUnits, USDC_DECIMALS));
  if (feeUnits > 0n) {
    tx.add(createAssociatedTokenAccountIdempotentInstruction(delegate.publicKey, feeAta, feeRecipient, USDC_MINT));
    tx.add(createTransferCheckedInstruction(source, USDC_MINT, feeAta, delegate.publicKey, feeUnits, USDC_DECIMALS));
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = delegate.publicKey;
  tx.sign(delegate);
  const signature = bs58.encode(tx.signature!);

  // Record the signature first: from here on the chain decides, never a second send.
  await setStatus(g.ids, "settling", { signature, error: null });
  try {
    await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`on-chain error: ${JSON.stringify(res.value.err)}`);
    await setStatus(g.ids, "paid");
    console.log(`[terminal] ✓ settled ${Number(g.totalUnits) / 1e6} USDC from ${g.wallet.slice(0, 4)}… (${g.ids.length} message(s))`);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
    // A preflight rejection never landed: failed (retried later). Otherwise resolveSettling decides.
    if (/simulation|insufficient|owner does not match|0x1\b|0x4\b/i.test(msg)) {
      await setStatus(g.ids, "failed", { error: msg });
      await alert(`Terminal charge failed for ${g.wallet}: ${Number(g.totalUnits) / 1e6} USDC to ${g.payoutWallet} (${msg})`);
    } else {
      console.warn(`[terminal] settle ${g.wallet.slice(0, 4)}… unconfirmed, will resolve from chain:`, msg);
    }
  }
}

async function cycle(conn: Connection, delegate: Keypair, feeRecipient: PublicKey): Promise<void> {
  const now = Date.now();
  await query("DELETE FROM terminal_charges WHERE status = 'reserved' AND updated_at < $1", [now - STALE_RESERVED_MS]);
  await resolveSettling(conn);
  const rows = await query<ChargeRow>(
    `SELECT id, wallet, payout_wallet, amount_units::text AS amount_units FROM terminal_charges
      WHERE status = 'pending' OR (status = 'failed' AND updated_at < $1)
      ORDER BY id LIMIT 500`,
    [now - RETRY_FAILED_MS],
  );
  for (const g of groupCharges(rows)) {
    await settleGroup(conn, delegate, feeRecipient, g).catch((err) => console.warn("[terminal] settle error:", err?.message ?? err));
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
    await cycle(conn, delegate, feeRecipient).catch((err) => console.warn("[terminal] cycle failed:", err?.message ?? err));
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => console.error("[terminal] stopped:", err));
