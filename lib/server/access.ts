/**
 * Invite-only access on the server (lib/access.ts is the rule). Grants and
 * invite codes live in the backend (access_grants, access_invites; lib/server/store.ts). Redeeming spends the code
 * and grants the wallet in one transaction that only applies to an unused code, so a code is never spent twice.
 */
import { randomInt } from "node:crypto";

import { ARC } from "@/lib/arc/config";
import {
  accessMinMimir,
  INVITE_ALPHABET,
  inviteDailyCap,
  inviteMintAllowance,
  invitesPerUser,
  inviteOnly,
  inviteUnlockMs,
  type AccessStatus,
} from "@/lib/access";
import { insert, store, StoreConflict } from "./store";
import { adminWallets } from "./admin";
import { getArcEvmBindingByArc } from "./arc-evm-accounts";

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
async function memberInvites(wallet: string, grant: Grant): Promise<AccessStatus["invites"]> {
  const allowance = invitesPerUser();
  const now = Date.now();
  type Invite = { code: string; used_by: string | null; created_at: number };
  const mine = async () => (await store().list<Invite>("access_invites", { i1: wallet })).sort((a, b) => a.created_at - b.created_at);
  let rows = await mine();
  // Admins (ADMIN_WALLETS) skip the waiting period: they can mint codes from the admin panel anyway.
  const unlockMs = adminWallets().has(wallet) ? 0 : inviteUnlockMs();
  const want = inviteMintAllowance({ grantedAt: grant.grantedAt, now, existing: rows.length, allowance, unlockMs });
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

/**
 * Where `wallet` stands: in only with a grant. New grants come from invite codes alone; holding $MIMIR no longer lets
 * a wallet in by itself (it buys fee perks, lib/token-tiers.ts). Grants made earlier, holder ones included, stay.
 * `wallet` is a Solana address or a checksummed Arc (EVM) address.
 */
export async function accessStatus(wallet: string): Promise<AccessStatus> {
  const minMimir = accessMinMimir();
  if (!isInviteOnly()) return { inviteOnly: false, allowed: true, via: "open", invites: [], minMimir };
  const now = Date.now();
  const grant = await grantOf(wallet);
  // Everyone who is in can bring others, once their grant has aged.
  const invites = grant ? await memberInvites(wallet, grant) : [];
  const unlockAt = grant && !adminWallets().has(wallet) ? grant.grantedAt + inviteUnlockMs() : null;
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

/** Codes minted from the admin panel have this owner; anyone may redeem them, and they skip the daily budget. */
export const ADMIN_INVITE_OWNER = "admin";

export type InviteRow = { code: string; owner: string; note: string | null; createdAt: number; usedBy: string | null; usedAt: number | null };

/** Every invite code, newest first (the admin panel). */
export async function listInvites(): Promise<InviteRow[]> {
  type Row = { code: string; owner: string; note?: string | null; created_at: number; used_by: string | null; used_at: number | null };
  const rows = await store().list<Row>("access_invites", { limit: 5000 });
  return rows
    .map((r) => ({ code: r.code, owner: r.owner, note: r.note ?? null, createdAt: Number(r.created_at), usedBy: r.used_by ?? null, usedAt: r.used_at == null ? null : Number(r.used_at) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** `count` fresh codes owned by the admin, with an optional note (who they are for). */
export async function mintAdminInvites(count: number, note: string | null): Promise<string[]> {
  const now = Date.now();
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = newCode();
    await insert("access_invites", code, { code, owner: ADMIN_INVITE_OWNER, note, created_at: now + i, used_by: null, used_at: null }, { i1: ADMIN_INVITE_OWNER, at: now + i });
    codes.push(code);
  }
  return codes;
}

/** Server-side gate for routes that act for a wallet (binding an Arc account). */
export async function hasAccess(wallet: string): Promise<boolean> {
  if (!isInviteOnly()) return true;
  return (await accessStatus(wallet)).allowed;
}

/**
 * Whether a passkey account belongs to someone who is in: its Solana wallet has access, or (native Arc sign-in) the
 * Arc wallet it is bound to does. An Arc-native member who links a Solana wallet later for $MIMIR perks needs no
 * second invite for it.
 */
export async function accountHasAccess(arcAccount: string, solana: string | null): Promise<boolean> {
  if (!isInviteOnly()) return true;
  if (solana && (await hasAccess(solana).catch(() => false))) return true;
  const evm = await getArcEvmBindingByArc(arcAccount).catch(() => null);
  return evm ? hasAccess(evm.evm).catch(() => false) : false;
}

/** For routes: null when `wallet` may act, else the reason to refuse with a 403 (invite-only and not in). */
export async function accessDenied(wallet: string): Promise<string | null> {
  if (!isInviteOnly()) return null;
  return (await hasAccess(wallet).catch(() => false)) ? null : "Mimir is invite-only: redeem an invite code first";
}
