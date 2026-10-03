/**
 * Storage for verdict audit bundles, keyed by the sha256 committed on chain.
 *
 * Not `server-only`: the oracle worker writes here outside the Next runtime.
 * Content-addressed, so a write is idempotent and a row can never be edited
 * into something else without its key no longer matching the chain.
 */
import { isDbEnabled, query } from "./db";
import { sealBundle, type VerdictBundle } from "../verdict-bundle";
import { IS_MAINNET } from "../solana/config";

/**
 * Stores the bundle; returns its hash. Without a database: a no-op (still
 * returns the hash) off mainnet, and an error with `required` (default on
 * mainnet), so the oracle never commits a hash nobody can check.
 */
export async function saveVerdictBundle(bundle: VerdictBundle, opts: { required?: boolean } = {}): Promise<string> {
  const { canonical, hash } = sealBundle(bundle);
  if (!isDbEnabled()) {
    if (opts.required ?? IS_MAINNET) throw new Error("verdict bundle store is not configured (DATABASE_URL)");
    return hash;
  }
  await query(
    `INSERT INTO verdict_bundles (hash, program, claim_id, bundle, created_at)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (hash) DO NOTHING`,
    [hash, bundle.program, bundle.claimId, canonical, Date.now()],
  );
  return hash;
}

/** The canonical JSON text stored under a hash, exactly as it was hashed. */
export async function getVerdictBundleText(hash: string): Promise<string | null> {
  if (!isDbEnabled() || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const rows = await query<{ bundle: string }>("SELECT bundle FROM verdict_bundles WHERE hash = $1", [hash]);
  return rows[0] ? String(rows[0].bundle) : null;
}
