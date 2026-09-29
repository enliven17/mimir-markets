/**
 * Storage for verdict audit bundles, keyed by the sha256 committed on chain.
 *
 * Not `server-only`: the oracle worker writes here outside the Next runtime.
 * Content-addressed, so a write is idempotent and a row can never be edited
 * into something else without its key no longer matching the chain.
 */
import { isDbEnabled, query } from "./db";
import { sealBundle, type VerdictBundle } from "../verdict-bundle";

/** Stores the bundle; returns its hash. No-op (still returns the hash) without a database. */
export async function saveVerdictBundle(bundle: VerdictBundle): Promise<string> {
  const { canonical, hash } = sealBundle(bundle);
  if (!isDbEnabled()) return hash;
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
