/** Solana owner identity is a case-sensitive base58 public key. */
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

export function normalizeOwner(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const key = new PublicKey(value.trim()); return key.toBase58() === value.trim() ? key.toBase58() : null; }
  catch { return null; }
}
export async function verifyOwnerSignature(args: { address: string; message: string; signature: string }): Promise<boolean> {
  const owner = normalizeOwner(args.address);
  if (!owner || typeof args.signature !== "string" || args.signature.length > 100) return false;
  try { const sig = bs58.decode(args.signature); return sig.length === 64 && nacl.sign.detached.verify(new TextEncoder().encode(args.message), sig, new PublicKey(owner).toBytes()); }
  catch { return false; }
}
