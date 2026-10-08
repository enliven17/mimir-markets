/**
 * Invite-only access on the server (lib/access.ts is the rule). Grants and
 * invite codes live in the backend (access_grants, access_invites; lib/server/store.ts). Redeeming spends the code
 * and grants the wallet in one transaction that only applies to an unused code, so a code is never spent twice.
 */
import { randomInt } from "node:crypto";

import { ARC } from "@/lib/arc/config";
import {
  accessMinMimir,
  HOLDER_RECHECK_MS,
  INVITE_ALPHABET,
  inviteDailyCap,
  inviteMintAllowance,
  invitesPerUser,
  inviteOnly,
  inviteUnlockMs,
  type AccessStatus,
} from "@/lib/access";
import { insert, store, StoreConflict } from "./store";
import { walletBalances } from "./holder";

export const isInviteOnly = () => inviteOnly(ARC.network, process.env.NEXT_PUBLIC_INVITE_ONLY?.trim());

function newCode(): string {
  const part = () => Array.from({ length: 4 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join("");
  return `MIMIR-${part()}-${part()}`;
}

type Grant = { via: "holder" | "invite"; grantedAt: number; checkedAt: number };

async function grantOf(wallet: string): Promise<Grant | null> {
  const row = await store().get<{ via: string; granted_at?: number; checked_at?: number }>("access_grants", wallet);
  if (!row) return null;
  const grantedAt = Number(row.granted_at ?? 0);
  return { via: row.via === "invite" ? "invite" : "holder", grantedAt, checkedAt: Number(row.checked_at ?? grantedAt) };
}

/** Takes up to `want` codes from today's issuance budget (all members together); returns how many it got. */
async function takeFromDailyBudget(want: number, now: number): Promise<number> {
  if (want <= 0) return 0;
  const day = new Date(now).toISOString().slice(0, 10);
  const cap = inviteDailyCap();
  const after = Number((await store().tx([{ op: "incr", t: "access_issuance", k: day, d: { day, issued: 0 }, field: "issued", by: want }]))[0]);
  const got = Math.max(0, Math.min(want, cap - (after - want)));
  if (got < want) await store().tx([{ op: "incr", t: "access_issuance", k: day, field: "issued", by: got - want }]);
  return got;
}

/**
 * A member's codes, topped up to the current allowance (idempotent). Raising MIMIR_INVITES_PER_USER hands everyone
 * the extra codes on their next visit; lowering it hides nothing already handed out.
 */
async function memberInvites(wallet: string, grant: Grant, holdsMinimum: boolean): Promise<AccessStatus["invites"]> {
  const allowance = invitesPerUser();
  const now = Date.now();
  type Invite = { code: string; used_by: string | null; created_at: number };
  const mine = async () => (await store().list<Invite>("access_invites", { i1: wallet })).sort((a, b) => a.created_at - b.created_at);
  let rows = await mine();
  const want = inviteMintAllowance({ via: grant.via, grantedAt: grant.grantedAt, now, holdsMinimum, existing: rows.length, allowance, unlockMs: inviteUnlockMs() });
  const mint = await takeFromDailyBudget(want, now);
  if (mint > 0) {
    for (let i = rows.length; i < rows.length + mint; i++) {
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
  const now = Date.now();
  let grant = await grantOf(wallet);
  if (!grant && isHolder) {
    await insert("access_grants", wallet, { wallet, via: "holder", code: null, granted_at: now, checked_at: now }, { i1: "holder", at: now });
    grant = { via: "holder", grantedAt: now, checkedAt: now };
  } else if (grant?.via === "holder" && isHolder && now - grant.checkedAt > HOLDER_RECHECK_MS) {
    // The balance was seen again: note it (a lapsed holder keeps access but mints no more codes).
    await store().tx([{ op: "update", t: "access_grants", k: wallet, d: { checked_at: now } }]);
  }
  // Everyone who is in can bring others, once their grant has aged (and a holder still holds).
  const invites = grant ? await memberInvites(wallet, grant, isHolder) : [];
  const unlockAt = grant ? grant.grantedAt + inviteUnlockMs() : null;
  return { inviteOnly: true, allowed: grant !== null, via: grant?.via ?? null, invites, minMimir, invitesUnlockAt: unlockAt && unlockAt > now ? unlockAt : null };
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

/** For routes: null when `wallet` may act, else the reason to refuse with a 403 (invite-only and not in). */
export async function accessDenied(wallet: string): Promise<string | null> {
  if (!isInviteOnly()) return null;
  return (await hasAccess(wallet).catch(() => false)) ? null : "Mimir is invite-only: hold the minimum $MIMIR or redeem an invite code first";
}
