/**
 * Invite-only access on the server (lib/access.ts is the rule). Grants and
 * invite codes live in the backend (access_grants, access_invites; lib/server/store.ts). Redeeming spends the code
 * and grants the wallet in one transaction that only applies to an unused code, so a code is never spent twice.
 */
import { randomInt } from "node:crypto";

import { ARC } from "@/lib/arc/config";
import { accessMinMimir, INVITE_ALPHABET, invitesPerUser, inviteOnly, type AccessStatus } from "@/lib/access";
import { insert, store, StoreConflict } from "./store";
import { walletBalances } from "./holder";

export const isInviteOnly = () => inviteOnly(ARC.network, process.env.NEXT_PUBLIC_INVITE_ONLY?.trim());

function newCode(): string {
  const part = () => Array.from({ length: 4 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join("");
  return `MIMIR-${part()}-${part()}`;
}

async function grantOf(wallet: string): Promise<{ via: "holder" | "invite" } | null> {
  const row = await store().get<{ via: string }>("access_grants", wallet);
  return row ? { via: row.via === "invite" ? "invite" : "holder" } : null;
}

/**
 * A member's codes, topped up to the current allowance (idempotent). Raising MIMIR_INVITES_PER_USER hands everyone
 * the extra codes on their next visit; lowering it hides nothing already handed out.
 */
async function memberInvites(wallet: string): Promise<AccessStatus["invites"]> {
  const allowance = invitesPerUser();
  const now = Date.now();
  type Invite = { code: string; used_by: string | null; created_at: number };
  const mine = async () => (await store().list<Invite>("access_invites", { i1: wallet })).sort((a, b) => a.created_at - b.created_at);
  let rows = await mine();
  if (rows.length < allowance) {
    for (let i = rows.length; i < allowance; i++) {
      const code = newCode();
      await insert("access_invites", code, { code, owner: wallet, created_at: now + i, used_by: null, used_at: null }, { i1: wallet, at: now + i });
    }
    rows = await mine();
  }
  return rows.map((r) => ({ code: r.code, used: r.used_by != null }));
}

/** Where `wallet` stands. A holder at or above the minimum is granted on the spot and gets its codes. */
export async function accessStatus(wallet: string): Promise<AccessStatus> {
  const minMimir = accessMinMimir();
  if (!isInviteOnly()) return { inviteOnly: false, allowed: true, via: "open", invites: [], minMimir };
  const mimir = await walletBalances(wallet).then((b) => b.mimir).catch(() => 0);
  const isHolder = mimir >= minMimir;
  let grant = await grantOf(wallet);
  if (!grant && isHolder) {
    const now = Date.now();
    await insert("access_grants", wallet, { wallet, via: "holder", code: null, granted_at: now }, { i1: "holder", at: now });
    grant = { via: "holder" };
  }
  // Everyone who is in can bring others: holders and invitees alike.
  const invites = grant ? await memberInvites(wallet) : [];
  return { inviteOnly: true, allowed: grant !== null, via: grant?.via ?? null, invites, minMimir };
}

export type RedeemResult = "ok" | "already" | "invalid" | "own";

export async function redeemInvite(wallet: string, code: string): Promise<RedeemResult> {
  if (await grantOf(wallet)) return "already";
  const invite = await store().get<{ owner: string; used_by: string | null }>("access_invites", code);
  if (!invite) return "invalid";
  if (invite.owner === wallet) return "own";
  if (invite.used_by != null) return "invalid";
  // One transaction: the code flips to used only while it is still unused, and the grant goes in with it.
  const now = Date.now();
  try {
    await store().tx([
      { op: "update", t: "access_invites", k: code, d: { used_by: wallet, used_at: now }, when: { used_by: null }, must: true },
      { op: "insert", t: "access_grants", k: wallet, d: { wallet, via: "invite", code, granted_at: now }, i1: "invite", at: now },
    ]);
  } catch (err) {
    if (err instanceof StoreConflict) return "invalid";
    throw err;
  }
  return "ok";
}

/** Server-side gate for routes that act for a wallet (binding an Arc account). */
export async function hasAccess(wallet: string): Promise<boolean> {
  if (!isInviteOnly()) return true;
  return (await accessStatus(wallet)).allowed;
}
