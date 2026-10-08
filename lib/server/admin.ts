/**
 * Who may open the admin panel, and how they prove it.
 *
 * Admins are the Solana wallets in ADMIN_WALLETS (comma list; empty or unset = nobody). Signing in is a fresh,
 * single-use challenge, not the 24-hour holder proof:
 *   1. GET /api/admin/nonce?wallet=W: for an admin wallet, a random nonce bound to the site's domain, valid 10 min.
 *   2. The wallet signs the exact message (adminLoginMessage) and POSTs it to /api/admin/session; the nonce is spent
 *      in the same step, and the request's Origin must be the domain the nonce was issued for.
 *   3. The answer is a session token, valid 10 minutes from sign-in, sent as `Authorization: Bearer <token>`.
 * Everyone else gets the same 404 an unknown route gives, so the panel does not reveal that it exists.
 */
import { randomBytes } from "node:crypto";

import { verifyAgentSignature } from "@/lib/agents/signature";
import { put, store, take } from "./store";

export const ADMIN_TTL_MS = 10 * 60_000;
const TABLE = "admin_nonces";

export function adminWallets(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.ADMIN_WALLETS ?? "").split(/[,\s]+/).filter(Boolean));
}

export function adminLoginMessage(a: { domain: string; wallet: string; nonce: string; issuedAt: number }): string {
  return [
    "Mimir admin sign-in",
    `domain: ${a.domain}`,
    `wallet: ${a.wallet}`,
    `nonce: ${a.nonce}`,
    `issued: ${new Date(a.issuedAt).toISOString()}`,
    "This signature opens the read-only admin panel for 10 minutes. It moves no funds.",
  ].join("\n");
}

type NonceRow = { wallet: string; domain: string; issuedAt: number };
type SessionRow = { wallet: string; expires: number };

/** Step 1: a challenge for an admin wallet, or null for anyone else. */
export async function issueAdminNonce(wallet: string, domain: string, now = Date.now(), env: Record<string, string | undefined> = process.env): Promise<{ nonce: string; message: string } | null> {
  if (!adminWallets(env).has(wallet)) return null;
  const nonce = randomBytes(16).toString("hex");
  await put(TABLE, `n:${nonce}`, { wallet, domain, issuedAt: now } satisfies NonceRow, { at: now });
  return { nonce, message: adminLoginMessage({ domain, wallet, nonce, issuedAt: now }) };
}

/** Step 2: the signed challenge for a session token; null when anything is off (the nonce is spent either way). */
export async function startAdminSession(
  a: { wallet: string; nonce: string; signature: string; origin: string | null },
  now = Date.now(),
  env: Record<string, string | undefined> = process.env,
): Promise<{ token: string; expires: number } | null> {
  if (!/^[0-9a-f]{32}$/.test(a.nonce)) return null;
  const row = await take<NonceRow>(TABLE, `n:${a.nonce}`);
  if (!row || row.wallet !== a.wallet || !adminWallets(env).has(a.wallet)) return null;
  if (now - row.issuedAt > ADMIN_TTL_MS) return null;
  let originHost: string | null = null;
  try {
    originHost = a.origin ? new URL(a.origin).host : null;
  } catch {
    originHost = null;
  }
  if (originHost !== row.domain) return null;
  const message = adminLoginMessage({ domain: row.domain, wallet: row.wallet, nonce: a.nonce, issuedAt: row.issuedAt });
  if (!verifyAgentSignature({ address: a.wallet, message, signature: a.signature })) return null;
  const token = randomBytes(24).toString("hex");
  const expires = now + ADMIN_TTL_MS;
  await put(TABLE, `s:${token}`, { wallet: a.wallet, expires } satisfies SessionRow, { at: now });
  return { token, expires };
}

/** Step 3: the admin wallet behind a request's bearer token, or null. */
export async function adminWallet(req: Request, now = Date.now(), env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const row = await store().get<SessionRow>(TABLE, `s:${token}`).catch(() => null);
  if (!row || row.expires < now || !adminWallets(env).has(row.wallet)) return null;
  return row.wallet;
}
