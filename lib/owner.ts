/**
 * Who owns a Mimir account: a Solana wallet (base58, ed25519) or a Robinhood Chain wallet (0x, EIP-191 personal_sign).
 * Both sign the same readable messages; this picks the check by the address's shape. The EVM check is offline too
 * (signature recovery, no RPC).
 */
import { getAddress, isAddress, verifyMessage } from "viem";

import { normalizeAddress, verifyAgentSignature } from "./agents/signature";

export const isEvmOwner = (owner: string) => owner.startsWith("0x");

/** A base58 Solana key, a checksummed 0x address, or null. */
export function normalizeOwner(value: unknown): string | null {
  if (typeof value === "string" && isAddress(value.trim(), { strict: false })) return getAddress(value.trim());
  return normalizeAddress(value);
}

// ponytail: EOA signatures only (65 bytes). A contract wallet (ERC-1271) would need a Robinhood Chain RPC read here.
const EOA_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export async function verifyOwnerSignature(args: { address: string; message: string; signature: string }): Promise<boolean> {
  const owner = normalizeOwner(args.address);
  if (!owner) return false;
  if (!isEvmOwner(owner)) return verifyAgentSignature({ ...args, address: owner });
  if (typeof args.signature !== "string" || !EOA_SIGNATURE.test(args.signature)) return false;
  try {
    return await verifyMessage({ address: owner as `0x${string}`, message: args.message, signature: args.signature as `0x${string}` });
  } catch {
    return false;
  }
}
