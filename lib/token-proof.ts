/**
 * Holder proof: a signed statement that the caller controls a wallet, so a
 * server-side perk can use that wallet's mainnet balance.
 *
 * The browser signs `holderProofMessage` once with the connected wallet
 * (ed25519, wallet-adapter `signMessage`, base58) and sends it on requests as
 *
 *   x-mimir-wallet: <base58 pubkey>
 *   x-mimir-proof:  <signedAt ms>.<base58 signature>
 *
 * It moves nothing and authorizes nothing but reading that wallet's tier. It
 * expires after HOLDER_PROOF_TTL_MS. Pure and isomorphic.
 */

export const HOLDER_PROOF_TTL_MS = 24 * 60 * 60 * 1000;
export const HOLDER_WALLET_HEADER = "x-mimir-wallet";
export const HOLDER_PROOF_HEADER = "x-mimir-proof";

export function holderProofMessage(wallet: string, signedAt: number): string {
  return [
    "Mimir holder proof",
    `wallet: ${wallet}`,
    `signedAt: ${signedAt}`,
    "This only proves you control this wallet so Mimir can read its token tier. It moves no funds.",
  ].join("\n");
}

export function formatProofHeader(signedAt: number, signature: string): string {
  return `${signedAt}.${signature}`;
}

/** `{signedAt, signature}` from the header value, or null when malformed or expired. */
export function parseProofHeader(
  value: string | null | undefined,
  now = Date.now(),
): { signedAt: number; signature: string } | null {
  const m = /^(\d{12,14})\.([1-9A-HJ-NP-Za-km-z]{64,90})$/.exec((value ?? "").trim());
  if (!m) return null;
  const signedAt = Number(m[1]);
  // A little clock skew into the future is fine; a lot is not.
  if (signedAt > now + 5 * 60_000 || now - signedAt > HOLDER_PROOF_TTL_MS) return null;
  return { signedAt, signature: m[2] };
}
