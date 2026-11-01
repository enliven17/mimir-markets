/**
 * Wallet proof: a signed statement that the caller controls an EVM wallet, so a server route can act for that wallet
 * (follows, access, invite codes).
 *
 * The browser signs `walletProofMessage` once with the connected wallet (EIP-191 personal_sign, lib/owner.ts) and
 * sends it on requests as
 *
 *   x-mimir-wallet: <0x address>
 *   x-mimir-proof:  <signedAt ms>.<0x hex signature>
 *
 * It moves nothing and authorizes nothing else. It expires after WALLET_PROOF_TTL_MS. Pure and isomorphic.
 */

export const WALLET_PROOF_TTL_MS = 24 * 60 * 60 * 1000;
export const WALLET_HEADER = "x-mimir-wallet";
export const WALLET_PROOF_HEADER = "x-mimir-proof";

export function walletProofMessage(wallet: string, signedAt: number): string {
  return [
    "Mimir wallet proof",
    `wallet: ${wallet}`,
    `signedAt: ${signedAt}`,
    "This only proves you control this wallet. It moves no funds.",
  ].join("\n");
}

export function formatProofHeader(signedAt: number, signature: string): string {
  return `${signedAt}.${signature}`;
}

/** `{signedAt, signature}` from the header value, or null when malformed or expired. */
export function parseProofHeader(
  value: string | null | undefined,
  now = Date.now(),
): { signedAt: number; signature: `0x${string}` } | null {
  // 65 bytes for a plain wallet; longer for a smart wallet (ERC-1271 / ERC-6492).
  const m = /^(\d{12,14})\.(0x[0-9a-fA-F]{130,20000})$/.exec((value ?? "").trim());
  if (!m) return null;
  const signedAt = Number(m[1]);
  // A little clock skew into the future is fine; a lot is not.
  if (signedAt > now + 5 * 60_000 || now - signedAt > WALLET_PROOF_TTL_MS) return null;
  return { signedAt, signature: m[2] as `0x${string}` };
}
