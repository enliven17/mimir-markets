/**
 * Invite-only access (mainnet launch). Open to everyone on testnet; invite-only
 * on mainnet unless NEXT_PUBLIC_INVITE_ONLY says otherwise ("1" forces it on,
 * "0" off). A wallet gets in by holding ACCESS_MIN_MIMIR $MIMIR on Solana,
 * which also hands it INVITES_PER_HOLDER codes, or by redeeming one of those
 * codes (no $MIMIR needed). Pure and isomorphic.
 */
export const INVITES_PER_HOLDER = 2;

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
  /** The holder's own codes; empty for everyone else. */
  invites: Array<{ code: string; used: boolean }>;
  minMimir: number;
}
