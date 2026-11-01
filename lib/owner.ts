/**
 * Who owns a Mimir account: an EVM wallet (0x address). The connected wallet is the user's identity on every chain
 * Mimir runs on (Arc, Base): it signs readable messages with EIP-191 personal_sign.
 *
 * A plain wallet's (EOA) signature is recovered offline. A smart wallet's (ERC-1271, or ERC-6492 before it is deployed)
 * is checked on chain, on Arc and then on Base, only when the signature is not a plain 65-byte one.
 */
import { createPublicClient, getAddress, http, isAddress, verifyMessage, type Address, type Hex } from "viem";

import { arcPublicClient } from "./arc/chain";
import { baseRpcUrl } from "./base/chain";

/** A checksummed 0x address, or null. */
export function normalizeOwner(value: unknown): Address | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return isAddress(v, { strict: false }) ? getAddress(v) : null;
}

const EOA_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const HEX_SIGNATURE = /^0x[0-9a-fA-F]{130,20000}$/;

export async function verifyOwnerSignature(args: { address: string; message: string; signature: string }): Promise<boolean> {
  const owner = normalizeOwner(args.address);
  if (!owner || typeof args.signature !== "string" || !HEX_SIGNATURE.test(args.signature)) return false;
  const signature = args.signature as Hex;
  if (EOA_SIGNATURE.test(signature)) return verifyMessage({ address: owner, message: args.message, signature }).catch(() => false);
  // A smart wallet: its contract decides (one eth_call per chain).
  for (const client of [() => arcPublicClient(), () => createPublicClient({ transport: http(baseRpcUrl(), { timeout: 10_000 }) })]) {
    if (await client().verifyMessage({ address: owner, message: args.message, signature }).catch(() => false)) return true;
  }
  return false;
}

