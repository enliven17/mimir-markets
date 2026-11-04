import { Keypair } from "@solana/web3.js";
import roster from "../../config/solana-roster.json";

/** Private operator material is read only in Convex Node actions, never public queries. */
export function operatorKey(): Keypair {
  const raw = process.env.SOLANA_KEYPAIR_JSON;
  if (!raw) throw new Error("Solana operator is not configured");
  const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  if (key.publicKey.toBase58() !== roster.creator) throw new Error("Solana operator does not match this devnet deployment");
  return key;
}
export function personaKey(slug: string): Keypair {
  // Existing council identity derivation; public roster is checked before use.
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const admin = operatorKey();
  const digest = createHash("sha256").update(admin.secretKey).update(`mimir-council:${slug}`).digest();
  const key = Keypair.fromSeed(digest.subarray(0, 32));
  if (key.publicKey.toBase58() !== (roster.council as Record<string, string>)[slug]) throw new Error("Council identity mismatch");
  return key;
}
