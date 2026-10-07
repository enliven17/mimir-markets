/**
 * The relay between a phone wallet and the page that asked it (lib/solana/deeplink-adapter.ts).
 *
 * Phantom and Solflare answer a deeplink request by opening `redirect_link` with their response in the query. In
 * the Android app that link is captured by the app itself, which forwards it here and steps aside, so the page that
 * asked is still on screen with its request pending; in a phone browser the link opens a new tab that forwards it
 * here. Either way the page collects the answer by its op id.
 *
 * What is stored is only the wallet's own response params (still encrypted for the page; the error fields are
 * plain), under a random 128-bit op id. First write wins, one read deletes it, and nothing older than TTL_MS is
 * ever returned.
 */
import { isDbEnabled, query } from "./db";

export const TTL_MS = 10 * 60_000;
/** A signAllTransactions answer for a CCTP burn is a few KB; anything far beyond that is not a wallet answer. */
export const MAX_PARAMS_BYTES = 64 * 1024;
const OP = /^[A-Za-z0-9_-]{22}$/;
/** The response fields Phantom and Solflare send back; anything else in the query is dropped. */
const FIELDS = ["nonce", "data", "phantom_encryption_public_key", "solflare_encryption_public_key", "errorCode", "errorMessage"] as const;

export type RelayParams = Partial<Record<(typeof FIELDS)[number], string>>;

export const isOp = (op: unknown): op is string => typeof op === "string" && OP.test(op);

/** The wallet fields of a redirect URL's query, or null when there are none or they are oversized. */
export function pickParams(search: URLSearchParams): RelayParams | null {
  const out: RelayParams = {};
  for (const f of FIELDS) {
    const v = search.get(f);
    if (v !== null) out[f] = v;
  }
  if (!Object.keys(out).length) return null;
  return Buffer.byteLength(JSON.stringify(out), "utf8") > MAX_PARAMS_BYTES ? null : out;
}

// ponytail: per-instance memory when there is no database; a serverless deploy without DATABASE_URL could park an
// answer on one instance and be polled on another. Every deploy here has a database.
const memory = new Map<string, { params: string; at: number }>();
function sweep(now: number) {
  for (const [k, v] of memory) if (v.at < now - TTL_MS) memory.delete(k);
}

/** Park a wallet answer. False when the op is malformed or already has one (first write wins). */
export async function putRelay(op: string, params: RelayParams, now = Date.now()): Promise<boolean> {
  if (!isOp(op)) return false;
  const body = JSON.stringify(params);
  if (Buffer.byteLength(body, "utf8") > MAX_PARAMS_BYTES) return false;
  if (!isDbEnabled()) {
    sweep(now);
    if (memory.has(op)) return false;
    memory.set(op, { params: body, at: now });
    return true;
  }
  await query(`DELETE FROM wallet_relay WHERE created_at < $1`, [now - TTL_MS]);
  const rows = await query(`INSERT INTO wallet_relay (op, params, created_at) VALUES ($1, $2, $3) ON CONFLICT (op) DO NOTHING RETURNING op`, [op, body, now]);
  return rows.length > 0;
}

/** Collect and delete a parked answer; null while the wallet has not answered (or it expired). */
export async function takeRelay(op: string, now = Date.now()): Promise<RelayParams | null> {
  if (!isOp(op)) return null;
  if (!isDbEnabled()) {
    sweep(now);
    const hit = memory.get(op);
    memory.delete(op);
    return hit ? (JSON.parse(hit.params) as RelayParams) : null;
  }
  const rows = await query<{ params: string; created_at: string | number }>(`DELETE FROM wallet_relay WHERE op = $1 RETURNING params, created_at`, [op]);
  const row = rows[0];
  if (!row || Number(row.created_at) < now - TTL_MS) return null;
  return JSON.parse(row.params) as RelayParams;
}
