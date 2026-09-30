import { Keypair } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Load the agent/admin keypair. Priority:
 *   1. SOLANA_KEYPAIR_JSON: the secret key itself, as a JSON byte array or
 *      base64 string. This is the Railway/container path: no filesystem
 *      needed, paste the value as an env var.
 *   2. SOLANA_KEYPAIR: path to a solana-keygen JSON file (local dev).
 *   3. ~/.config/solana/talos-deploy.json: local default.
 */
export function loadAgentKeypair(): Keypair {
  const raw = process.env.SOLANA_KEYPAIR_JSON?.trim();
  if (raw) {
    const bytes = raw.startsWith("[")
      ? Uint8Array.from(JSON.parse(raw))
      : Uint8Array.from(Buffer.from(raw, "base64"));
    return Keypair.fromSecretKey(bytes);
  }
  const path =
    process.env.SOLANA_KEYPAIR ||
    join(homedir(), ".config", "solana", "talos-deploy.json");
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))
  );
}

/**
 * The market-creator signs with its own wallet when one is provided, so the
 * oracle (a different wallet) is allowed to auto-challenge its claims
 * (the program rejects self-challenges). Falls back to the admin keypair.
 * Env: CREATOR_KEYPAIR_JSON (secret key) or CREATOR_KEYPAIR (file path).
 */
export function loadCreatorKeypair(): Keypair {
  const raw = process.env.CREATOR_KEYPAIR_JSON?.trim();
  if (raw) {
    const bytes = raw.startsWith("[")
      ? Uint8Array.from(JSON.parse(raw))
      : Uint8Array.from(Buffer.from(raw, "base64"));
    return Keypair.fromSecretKey(bytes);
  }
  const path = process.env.CREATOR_KEYPAIR?.trim();
  if (path && existsSync(path)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))
    );
  }
  return loadAgentKeypair();
}

/**
 * Deterministic persona keypair derived from the admin secret + slug.
 * Stateless: survives ephemeral container filesystems (Railway redeploys)
 * without re-funding a fresh wallet each time. Local dev keeps using the
 * .keys/council/<slug>.json files when they already exist.
 */
export function derivePersonaKeypair(admin: Keypair, slug: string): Keypair {
  const seed = createHash("sha256")
    .update(admin.secretKey)
    .update(`mimir-council:${slug}`)
    .digest();
  return Keypair.fromSeed(seed);
}

export function loadPersonaKeypair(admin: Keypair, slug: string): Keypair {
  const path = join(process.cwd(), ".keys", "council", `${slug}.json`);
  if (existsSync(path)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))
    );
  }
  return derivePersonaKeypair(admin, slug);
}
