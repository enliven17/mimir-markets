import { Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { IS_MAINNET } from "./config";

/** A secret key from an env value: a JSON byte array or base64. */
function secretFromEnv(raw: string): Keypair {
  const bytes = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw))
    : Uint8Array.from(Buffer.from(raw, "base64"));
  return Keypair.fromSecretKey(bytes);
}

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
  if (raw) return secretFromEnv(raw);
  const path =
    process.env.SOLANA_KEYPAIR ||
    join(homedir(), ".config", "solana", "talos-deploy.json");
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(/*turbopackIgnore: true*/ path, "utf8")))
  );
}

/**
 * The wallet that signs Flash Trade hedges (HEDGE_MODE=live), kept apart from
 * the oracle so a bad Flash-built tx can at most spend the hedge float.
 * Env: HEDGE_KEYPAIR_JSON or HEDGE_KEYPAIR (file path). Null when unset;
 * throws when it is the oracle/admin key.
 */
export function loadHedgeKeypair(): Keypair | null {
  const raw = process.env.HEDGE_KEYPAIR_JSON?.trim();
  const path = process.env.HEDGE_KEYPAIR?.trim();
  const hedge = raw
    ? secretFromEnv(raw)
    : path && existsSync(/*turbopackIgnore: true*/ path)
      ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(/*turbopackIgnore: true*/ path, "utf8"))))
      : null;
  if (hedge && hedge.publicKey.toBase58() === agentPublicKeyOrNull()) {
    throw new Error("HEDGE_KEYPAIR must not be the oracle/admin keypair");
  }
  return hedge;
}

/** The agent (oracle/admin) public key when this process can load it, else null. */
function agentPublicKeyOrNull(): string | null {
  try {
    return loadAgentKeypair().publicKey.toBase58();
  } catch {
    return null;
  }
}

/**
 * The market-creator signs with its own wallet when one is provided, so the
 * oracle (a different wallet) is allowed to auto-challenge its claims
 * (the program rejects self-challenges).
 * Env: CREATOR_KEYPAIR_JSON (secret key) or CREATOR_KEYPAIR (file path).
 *
 * Off mainnet it falls back to the admin keypair. On mainnet there is no
 * fallback (audit P0-1): a missing creator key, or one equal to the
 * admin/oracle key, throws.
 */
export function loadCreatorKeypair(opts: { mainnet?: boolean } = {}): Keypair {
  let creator: Keypair | null = null;
  const raw = process.env.CREATOR_KEYPAIR_JSON?.trim();
  const path = process.env.CREATOR_KEYPAIR?.trim();
  if (raw) {
    creator = secretFromEnv(raw);
  } else if (path && existsSync(/*turbopackIgnore: true*/ path)) {
    creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(/*turbopackIgnore: true*/ path, "utf8"))));
  }
  if (!(opts.mainnet ?? IS_MAINNET)) return creator ?? loadAgentKeypair();
  if (!creator) {
    throw new Error("CREATOR_KEYPAIR_JSON (or CREATOR_KEYPAIR) must be set on mainnet: the creator never falls back to the admin key");
  }
  if (creator.publicKey.toBase58() === agentPublicKeyOrNull()) {
    throw new Error("the creator key must differ from the admin/oracle key (SOLANA_KEYPAIR) on mainnet");
  }
  return creator;
}

/**
 * The house creator's public key without its secret: CREATOR_PUBKEY when set
 * (processes that only need to recognise house markets), else the creator
 * keypair's.
 */
export function loadCreatorPublicKey(opts: { mainnet?: boolean } = {}): PublicKey {
  const raw = process.env.CREATOR_PUBKEY?.trim();
  return raw ? new PublicKey(raw) : loadCreatorKeypair(opts).publicKey;
}

/**
 * COUNCIL_KEY_SEED: the secret persona keys derive from, independent of the
 * admin key (audit P0-1). Hex or base64, at least 32 bytes; null when unset.
 */
export function councilKeySeed(raw = process.env.COUNCIL_KEY_SEED): Buffer | null {
  const v = raw?.trim();
  if (!v) return null;
  const bytes = /^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0 ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  if (bytes.length < 32) throw new Error("COUNCIL_KEY_SEED must hold at least 32 bytes (hex or base64)");
  return bytes;
}

/**
 * Deterministic persona keypair: sha256(secret ‖ "mimir-council:" ‖ slug).
 * Stateless: survives ephemeral container filesystems (Railway redeploys)
 * without re-funding a fresh wallet each time.
 *
 * The secret is COUNCIL_KEY_SEED when set. Without it, and only off mainnet,
 * it is the admin secret, so the devnet persona wallets keep their funds. On
 * mainnet a missing seed throws: a leaked admin key must not also hand over
 * every persona wallet. `seed: null` forces the legacy admin derivation.
 */
export function derivePersonaKeypair(
  admin: Keypair,
  slug: string,
  opts: { seed?: Uint8Array | null; mainnet?: boolean } = {},
): Keypair {
  const seed = opts.seed === undefined ? councilKeySeed() : opts.seed;
  if (!seed && (opts.mainnet ?? IS_MAINNET)) {
    throw new Error("COUNCIL_KEY_SEED must be set on mainnet: persona keys never derive from the admin key there");
  }
  const digest = createHash("sha256")
    .update(seed ?? admin.secretKey)
    .update(`mimir-council:${slug}`)
    .digest();
  return Keypair.fromSeed(digest);
}

/** Local dev keeps using the .keys/council/<slug>.json files when they already exist. */
export function loadPersonaKeypair(admin: Keypair, slug: string): Keypair {
  const path = join(process.cwd(), ".keys", "council", `${slug}.json`);
  if (existsSync(/*turbopackIgnore: true*/ path)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(/*turbopackIgnore: true*/ path, "utf8")))
    );
  }
  return derivePersonaKeypair(admin, slug);
}
