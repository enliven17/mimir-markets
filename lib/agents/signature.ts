/**
 * Signature verification for agent requests.
 *
 * An agent's owner and operator are EVM wallets. They sign the UTF-8 request message with EIP-191 personal_sign; a
 * smart wallet's signature is checked on chain (lib/owner.ts).
 */
import { normalizeOwner, verifyOwnerSignature } from "../owner";

/** A wallet that can own or operate an agent: an EVM address, checksummed, or null. */
export function normalizeWallet(value: unknown): string | null {
  return normalizeOwner(value);
}

/** EIP-191 (or ERC-1271 for a smart wallet) signature of `message` by `address`. */
export async function verifyWalletSignature(args: { address: string; message: string; signature: string }): Promise<boolean> {
  return verifyOwnerSignature(args);
}
