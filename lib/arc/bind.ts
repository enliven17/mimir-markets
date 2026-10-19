/**
 * Binding a Solana or Robinhood Chain wallet to an Arc account (docs/ARC.md, "Accounts and identity").
 *
 * Both sides sign the same readable message: the owner wallet (Solana: ed25519,
 * wallet-adapter `signMessage`, base58; Robinhood: EIP-191 personal_sign, lib/owner.ts) and the passkey smart account (EIP-191
 * through ERC-1271, or ERC-6492 while the account is not deployed yet). The
 * owner's signature proves who is binding; the Arc signature proves the Arc
 * account is theirs, so nobody can bind (and squat) someone else's account.
 *
 * The message carries `signedAt`; the server accepts it for ARC_BIND_TTL_MS.
 * Pure and isomorphic: the Arc signature needs an Arc RPC call, so the server
 * checks it separately (lib/server/arc-accounts.ts `verifyArcSignature`).
 */
import { isEvmOwner, normalizeOwner, verifyOwnerSignature } from "../owner";
import { normalizeArcAddress } from "./encoding";

export const ARC_BIND_TTL_MS = 5 * 60_000;

/** `solana` is the owner wallet; a 0x owner is a Robinhood Chain wallet and is named so in the message. */
export function arcBindMessage(solana: string, arc: string, signedAt: number): string {
  const evm = isEvmOwner(solana);
  return [
    "Mimir Arc account",
    `${evm ? "robinhood" : "solana"}: ${solana}`,
    `arc: ${arc}`,
    `signedAt: ${signedAt}`,
    `This links your ${evm ? "Robinhood" : "Solana"} wallet to your Arc account on Mimir. It moves no funds.`,
  ].join("\n");
}

/** Within the TTL, with the same allowance for a client clock running ahead. */
export function isFreshArcBind(signedAt: number, now = Date.now()): boolean {
  return Number.isSafeInteger(signedAt) && signedAt <= now + ARC_BIND_TTL_MS && now - signedAt <= ARC_BIND_TTL_MS;
}

export interface ArcBindRequest {
  /** The owner wallet: a Solana key or a 0x Robinhood Chain address (lib/owner.ts). */
  solana: string;
  arc: `0x${string}`;
  signedAt: number;
  solanaSignature: string;
  arcSignature: `0x${string}`;
  credentialId: string | null;
}

export type ArcBindCheck =
  | { ok: true; request: ArcBindRequest; message: string }
  | { ok: false; status: 400 | 401; error: string };

const CREDENTIAL_ID = /^[A-Za-z0-9_-]{16,512}$/;
const HEX_SIGNATURE = /^0x[0-9a-fA-F]{130,20000}$/;

/**
 * Shape, freshness and the owner's signature. The Arc signature is only
 * checked for shape here.
 */
export async function checkArcBindBody(body: Record<string, unknown>, now = Date.now()): Promise<ArcBindCheck> {
  const solana = normalizeOwner(body.solana);
  if (!solana) return { ok: false, status: 400, error: "solana must be a Solana public key or a 0x wallet address" };
  const arc = normalizeArcAddress(body.arc);
  if (!arc) return { ok: false, status: 400, error: "arc must be an EVM address" };
  const signedAt = Number(body.signedAt);
  if (!isFreshArcBind(signedAt, now)) {
    return { ok: false, status: 401, error: "signedAt must be a ms timestamp within 5 minutes of now" };
  }
  const arcSignature = typeof body.arcSignature === "string" ? body.arcSignature.trim() : "";
  if (!HEX_SIGNATURE.test(arcSignature)) return { ok: false, status: 400, error: "arcSignature must be hex" };
  const credentialId =
    typeof body.credentialId === "string" && CREDENTIAL_ID.test(body.credentialId) ? body.credentialId : null;
  const message = arcBindMessage(solana, arc, signedAt);
  const solanaSignature = String(body.solanaSignature ?? "");
  if (!(await verifyOwnerSignature({ address: solana, message, signature: solanaSignature }))) {
    return { ok: false, status: 401, error: "the wallet signature does not match" };
  }
  return {
    ok: true,
    message,
    request: { solana, arc, signedAt, solanaSignature, arcSignature: arcSignature as `0x${string}`, credentialId },
  };
}
