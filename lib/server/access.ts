/**
 * Invite-only access on the server (lib/access.ts is the rule). Grants and
 * invite codes live in Neon (access_grants, access_invites). Redeeming is one
 * atomic UPDATE on an unused code, so a code is never spent twice.
 */
import { randomInt } from "node:crypto";

import { ARC } from "@/lib/arc/config";
import { accessMinMimir, INVITE_ALPHABET, INVITES_PER_HOLDER, inviteOnly, type AccessStatus } from "@/lib/access";
import { query } from "./db";
import { walletBalances } from "./holder";

export const isInviteOnly = () => inviteOnly(ARC.network, process.env.NEXT_PUBLIC_INVITE_ONLY?.trim());

function newCode(): string {
  const part = () => Array.from({ length: 4 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join("");
  return `MIMIR-${part()}-${part()}`;
}

async function grantOf(wallet: string): Promise<{ via: "holder" | "invite" } | null> {
  const rows = await query<{ via: string }>("SELECT via FROM access_grants WHERE wallet = $1", [wallet]);
  return rows[0] ? { via: rows[0].via === "invite" ? "invite" : "holder" } : null;
}

/** A holder's codes, creating the missing ones (idempotent: always exactly INVITES_PER_HOLDER). */
async function holderInvites(wallet: string): Promise<AccessStatus["invites"]> {
  const now = Date.now();
  let rows = await query<{ code: string; used_by: string | null }>("SELECT code, used_by FROM access_invites WHERE owner = $1 ORDER BY created_at", [wallet]);
  for (let i = rows.length; i < INVITES_PER_HOLDER; i++) {
    await query("INSERT INTO access_invites (code, owner, created_at) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING", [newCode(), wallet, now + i]);
  }
  if (rows.length < INVITES_PER_HOLDER) {
    rows = await query("SELECT code, used_by FROM access_invites WHERE owner = $1 ORDER BY created_at", [wallet]);
  }
  return rows.slice(0, INVITES_PER_HOLDER).map((r) => ({ code: r.code, used: r.used_by !== null }));
}

/** Where `wallet` stands. A holder at or above the minimum is granted on the spot and gets its codes. */
export async function accessStatus(wallet: string): Promise<AccessStatus> {
  const minMimir = accessMinMimir();
  if (!isInviteOnly()) return { inviteOnly: false, allowed: true, via: "open", invites: [], minMimir };
  const mimir = await walletBalances(wallet).then((b) => b.mimir).catch(() => 0);
  const isHolder = mimir >= minMimir;
  let grant = await grantOf(wallet);
  if (!grant && isHolder) {
    await query("INSERT INTO access_grants (wallet, via, granted_at) VALUES ($1, 'holder', $2) ON CONFLICT (wallet) DO NOTHING", [wallet, Date.now()]);
    grant = { via: "holder" };
  }
  // Codes are a holder's perk: whoever holds the minimum now gets them, whatever let them in first.
  const invites = isHolder ? await holderInvites(wallet) : [];
  return { inviteOnly: true, allowed: grant !== null, via: grant?.via ?? null, invites, minMimir };
}

export type RedeemResult = "ok" | "already" | "invalid" | "own";

export async function redeemInvite(wallet: string, code: string): Promise<RedeemResult> {
  if (await grantOf(wallet)) return "already";
  // One statement: only an unused code that is not the caller's own flips to used.
  const claimed = await query<{ owner: string }>(
    "UPDATE access_invites SET used_by = $2, used_at = $3 WHERE code = $1 AND used_by IS NULL AND owner <> $2 RETURNING owner",
    [code, wallet, Date.now()],
  );
  if (!claimed.length) {
    const own = await query("SELECT 1 FROM access_invites WHERE code = $1 AND owner = $2", [code, wallet]);
    return own.length ? "own" : "invalid";
  }
  await query("INSERT INTO access_grants (wallet, via, code, granted_at) VALUES ($1, 'invite', $2, $3) ON CONFLICT (wallet) DO NOTHING", [wallet, code, Date.now()]);
  return "ok";
}

/** Server-side gate for routes that act for a wallet (binding an Arc account). */
export async function hasAccess(wallet: string): Promise<boolean> {
  if (!isInviteOnly()) return true;
  return (await accessStatus(wallet)).allowed;
}
