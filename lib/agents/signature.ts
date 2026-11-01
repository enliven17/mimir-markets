/**
 * Signature verification for agent requests.
 *
 * An agent's identity is a Solana public key. It signs the UTF-8 bytes of the
 * request message with ed25519 (a Keypair's `nacl.sign.detached`, or a wallet
 * adapter's `signMessage`) and sends the 64-byte signature base58-encoded.
 * Verification is pure and offline: no RPC, no chain lookup.
 */
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { normalizeOwner, verifyOwnerSignature } from "../owner";

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** A base58 Solana public key, or null. Never lowercased: base58 is case-sensitive. */
export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!BASE58_PUBKEY.test(trimmed)) return null;
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    return null;
  }
}

export function encodeSignature(signature: Uint8Array): string {
  return bs58.encode(signature);
}

/** Sign a message with a raw 64-byte ed25519 secret key (a Keypair's `secretKey`). */
export function signAgentMessage(message: string, secretKey: Uint8Array): string {
  return encodeSignature(nacl.sign.detached(new TextEncoder().encode(message), secretKey));
}

export function verifyAgentSignature(args: {
  address: string;
  message: string;
  signature: string;
}): boolean {
  const { address, message, signature } = args;
  const pubkey = normalizeAddress(address);
  if (!pubkey || typeof signature !== "string" || !BASE58_SIGNATURE.test(signature)) return false;
  let sig: Uint8Array;
  try {
    sig = bs58.decode(signature);
  } catch {
    return false;
  }
  if (sig.length !== nacl.sign.signatureLength) return false;
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      sig,
      new PublicKey(pubkey).toBytes(),
    );
  } catch {
    return false;
  }
}

/**
 * A wallet that can own or operate an agent: an EVM address (a person's connected wallet, lib/owner.ts) or a base58
 * Solana key (an agent's own ed25519 keypair, the SDK). Checksummed / canonical, or null.
 */
export function normalizeWallet(value: unknown): string | null {
  return normalizeOwner(value) ?? normalizeAddress(value);
}

export const isSolanaKey = (wallet: string) => normalizeAddress(wallet) === wallet;

/** Checks `signature` for whichever kind `address` is: EIP-191 for an EVM wallet, ed25519 for a Solana key. */
export async function verifyWalletSignature(args: { address: string; message: string; signature: string }): Promise<boolean> {
  return normalizeOwner(args.address) ? verifyOwnerSignature(args) : verifyAgentSignature(args);
}
