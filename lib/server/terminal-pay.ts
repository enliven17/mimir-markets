/**
 * Mimir Terminal payments, the web side. It holds no key: it proves who asks
 * (terminal session), checks the on-chain spending limit, and records charges.
 * The settlement worker (agents/terminal/settle.ts) moves the money.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, TokenAccountNotFoundError } from "@solana/spl-token";

import { normalizeAddress, verifyAgentSignature } from "../agents/signature";
import { SOLANA_RPC, USDC_MINT } from "../solana/config";
import {
  canAfford,
  parseSessionHeader,
  terminalSessionMessage,
  TERMINAL_SESSION_HEADER,
  TERMINAL_WALLET_HEADER,
} from "../terminal/pay";
import { getDb, query } from "./db";
import { cachedFor } from "./ttl-cache";

/** The terminal's delegate: the key users approve a spending limit to. Null = paid agents are off. */
export function terminalDelegate(): string | null {
  return normalizeAddress(process.env.NEXT_PUBLIC_TERMINAL_DELEGATE ?? "") ?? null;
}

/** The wallet a request proves with its terminal session, or null. */
export function sessionWallet(req: Request, now = Date.now()): string | null {
  const wallet = normalizeAddress(req.headers.get(TERMINAL_WALLET_HEADER));
  const session = parseSessionHeader(req.headers.get(TERMINAL_SESSION_HEADER), now);
  if (!wallet || !session) return null;
  const ok = verifyAgentSignature({ address: wallet, message: terminalSessionMessage(wallet, session.signedAt), signature: session.signature });
  return ok ? wallet : null;
}

export interface Allowance {
  delegate: string | null;
  delegatedUnits: bigint;
  balanceUnits: bigint;
}

let connection: Connection | null = null;

/**
 * The wallet's USDC account as the chain sees it right now: who may spend
 * from it, how much, and the balance. No account yet = nothing approved; an
 * RPC failure throws (it must not read as "no limit").
 */
export async function readAllowance(wallet: string): Promise<Allowance> {
  connection ??= new Connection(SOLANA_RPC, "confirmed");
  const ata = getAssociatedTokenAddressSync(USDC_MINT, new PublicKey(wallet), true);
  try {
    const acc = await getAccount(connection, ata, "confirmed");
    return { delegate: acc.delegate?.toBase58() ?? null, delegatedUnits: acc.delegatedAmount, balanceUnits: acc.amount };
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) return { delegate: null, delegatedUnits: 0n, balanceUnits: 0n };
    throw err;
  }
}

/**
 * Cached for display only (GET /api/terminal/limit). Reserving a charge reads
 * the chain fresh: a settlement just spent part of the limit, and a stale
 * read would let charges past what is left.
 */
export const allowanceOf = cachedFor(readAllowance, 8_000, 2_000);

/** What a wallet already owes: every charge not yet paid (reserved, pending, settling, failed). */
export async function owedUnits(wallet: string): Promise<bigint> {
  const rows = await query<{ owed: string | null }>(
    "SELECT COALESCE(SUM(amount_units), 0)::text AS owed FROM terminal_charges WHERE wallet = $1 AND status <> 'paid'",
    [wallet],
  );
  return BigInt(rows[0]?.owed ?? "0");
}

/**
 * Reserve one paid message before it is relayed. The affordability check and
 * the insert run under a per-wallet lock, so two quick messages cannot both
 * fit under the same room. The row id, or why the wallet cannot pay.
 */
export async function reserveCharge(args: {
  wallet: string;
  agentId: string;
  payoutWallet: string;
  priceUnits: bigint;
  allowance: Allowance;
  delegate: string;
  now?: number;
}): Promise<{ id: number } | { reason: Exclude<ReturnType<typeof canAfford>, "ok"> }> {
  const now = args.now ?? Date.now();
  const pool = await getDb();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`terminal-wallet:${args.wallet}`]);
    const owed = await client.query("SELECT COALESCE(SUM(amount_units), 0)::text AS owed FROM terminal_charges WHERE wallet = $1 AND status <> 'paid'", [
      args.wallet,
    ]);
    const verdict = canAfford({
      delegate: args.allowance.delegate,
      expectedDelegate: args.delegate,
      delegatedUnits: args.allowance.delegatedUnits,
      balanceUnits: args.allowance.balanceUnits,
      owedUnits: BigInt(owed.rows[0]?.owed ?? "0"),
      priceUnits: args.priceUnits,
    });
    if (verdict !== "ok") {
      await client.query("COMMIT");
      return { reason: verdict };
    }
    const res = await client.query(
      `INSERT INTO terminal_charges (wallet, agent_id, payout_wallet, amount_units, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'reserved', $5, $5) RETURNING id`,
      [args.wallet, args.agentId, args.payoutWallet, args.priceUnits.toString(), now],
    );
    await client.query("COMMIT");
    return { id: Number(res.rows[0].id) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The agent answered: the charge is owed. */
export async function confirmCharge(id: number, now = Date.now()): Promise<void> {
  await query("UPDATE terminal_charges SET status = 'pending', updated_at = $2 WHERE id = $1 AND status = 'reserved'", [id, now]);
}

/** The agent did not answer: nothing is owed. */
export async function releaseCharge(id: number): Promise<void> {
  await query("DELETE FROM terminal_charges WHERE id = $1 AND status = 'reserved'", [id]);
}
