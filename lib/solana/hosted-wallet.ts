/** Server-only wallet encryption, bound to a random wallet id with AES-GCM. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";

function master() {
  const raw = process.env.SOLANA_WALLET_SECRET?.trim();
  if (!raw || raw.length < 32) throw new Error("SOLANA_WALLET_SECRET is not configured");
  return createHash("sha256").update(raw).digest();
}
export interface HostedWallet { walletId: string; address: string; sealed: string }
export function createHostedWallet(): HostedWallet {
  const key = Keypair.generate(), walletId = randomUUID(), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", master(), iv);
  c.setAAD(Buffer.from(`mimir:solana:devnet:wallet:${walletId}`));
  const ct = Buffer.concat([c.update(key.secretKey), c.final()]);
  return { walletId, address: key.publicKey.toBase58(), sealed: Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64") };
}
export function openHostedWallet(w: HostedWallet): Keypair {
  const raw = Buffer.from(w.sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", master(), raw.subarray(0, 12));
  d.setAAD(Buffer.from(`mimir:solana:devnet:wallet:${w.walletId}`)); d.setAuthTag(raw.subarray(12, 28));
  const key = Keypair.fromSecretKey(Buffer.concat([d.update(raw.subarray(28)), d.final()]));
  if (key.publicKey.toBase58() !== w.address) throw new Error("Hosted wallet identity mismatch");
  return key;
}
