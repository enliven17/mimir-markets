/**
 * Invite-only access (mainnet launch). Open to everyone on testnet; invite-only
 * on mainnet unless NEXT_PUBLIC_INVITE_ONLY says otherwise ("1" forces it on,
 * "0" off). A wallet gets in by holding the minimum $MIMIR on Solana or by
 * redeeming an invite code (no $MIMIR needed). Everyone who is in gets
 * invitesPerUser() codes of their own; raising MIMIR_INVITES_PER_USER later
 * (2 → 3) tops every member up on their next visit. Pure and isomorphic.
 */
export function invitesPerUser(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MIMIR_INVITES_PER_USER?.trim());
  return Number.isInteger(n) && n >= 0 && n <= 50 ? n : 2;
}

export function accessMinMimir(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MIMIR_ACCESS_MIN?.trim());
  return Number.isFinite(n) && n > 0 ? n : 5_000_000;
}

export function inviteOnly(network: string, flag: string | undefined): boolean {
  if (flag === "1") return true;
  if (flag === "0") return false;
  return network === "mainnet";
}

/** MIMIR-XXXX-XXXX: no 0/O/1/I so it survives being read aloud or typed from a screenshot. */
export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_PATTERN = /^MIMIR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function normalizeInvite(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/\s+/g, "");
  return INVITE_PATTERN.test(code) ? code : null;
}

export interface AccessStatus {
  inviteOnly: boolean;
  allowed: boolean;
  via: "open" | "holder" | "invite" | null;
  /** This member's own codes (empty until they are in). */
  invites: Array<{ code: string; used: boolean }>;
  minMimir: number;
}
