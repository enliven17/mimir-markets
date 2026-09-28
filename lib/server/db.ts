// Shared by the Next.js API routes (server) and the workers (Node). No
// "server-only" guard — that throws outside the Next bundler. DATABASE_URL is
// never NEXT_PUBLIC_, so it can't leak to the client regardless.
import { Pool, neonConfig } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import ws from "ws";

/**
 * One Neon Postgres pool and one schema bootstrap for every off-chain table.
 *
 * The database is optional: when DATABASE_URL is unset `isDbEnabled()` is
 * false and `getDb()` throws, so callers check first (or catch) and degrade.
 *
 * Adding a table: append its `CREATE TABLE IF NOT EXISTS` (and indexes) to
 * SCHEMA_STATEMENTS. The fingerprint changes, so the next boot re-runs the DDL
 * once; every statement must therefore be idempotent.
 */

if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
}

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  // Read index of on-chain claims (lib/server/solana-index.ts).
  `CREATE TABLE IF NOT EXISTS solana_claims (
    id                      INTEGER PRIMARY KEY,
    creator                 TEXT NOT NULL,
    question                TEXT NOT NULL DEFAULT '',
    creator_position        TEXT NOT NULL DEFAULT '',
    counter_position        TEXT NOT NULL DEFAULT '',
    resolution_url          TEXT NOT NULL DEFAULT '',
    category                TEXT NOT NULL DEFAULT '',
    creator_stake           TEXT NOT NULL DEFAULT '0',
    total_challenger_stake  TEXT NOT NULL DEFAULT '0',
    deadline                BIGINT NOT NULL DEFAULT 0,
    state                   SMALLINT NOT NULL DEFAULT 0,
    winner_side             SMALLINT NOT NULL DEFAULT 0,
    resolution_summary      TEXT NOT NULL DEFAULT '',
    confidence              SMALLINT NOT NULL DEFAULT 0,
    created_at              BIGINT NOT NULL DEFAULT 0,
    max_challengers         SMALLINT NOT NULL DEFAULT 0,
    delegated               BOOLEAN NOT NULL DEFAULT FALSE,
    challengers             JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at              BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS solana_claims_state_idx ON solana_claims (state)`,
  `CREATE INDEX IF NOT EXISTS solana_claims_deadline_idx ON solana_claims (deadline)`,
  `CREATE INDEX IF NOT EXISTS solana_claims_category_idx ON solana_claims (category)`,
  // V3 program: optimistic resolution + fee terms. `program` scopes rows to one
  // program id, so claim #1 of a redeployed program never mixes with the old #1.
  `ALTER TABLE solana_claims
     ADD COLUMN IF NOT EXISTS program          TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS proposed_side    SMALLINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS proposed_at      BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS disputable_until BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS disputer         TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS disputed_at      BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS bond             TEXT NOT NULL DEFAULT '0',
     ADD COLUMN IF NOT EXISTS bond_state       SMALLINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS dispute_window   BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS resolution_grace BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS resolved_at      BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS creator_agent    TEXT NOT NULL DEFAULT '',
     ADD COLUMN IF NOT EXISTS platform_fee_bps SMALLINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS agent_fee_bps    SMALLINT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS total_fees       TEXT NOT NULL DEFAULT '0',
     ADD COLUMN IF NOT EXISTS creator_paid     BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE INDEX IF NOT EXISTS solana_claims_program_idx ON solana_claims (program)`,
  // Fixed-window counters for public routes (lib/server/rate-limit.ts).
  `CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key   TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    hits         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_key, window_start)
  )`,
  // Small key/value state: worker heartbeats (lib/ops/heartbeat.ts), cursors.
  `CREATE TABLE IF NOT EXISTS app_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at BIGINT NOT NULL DEFAULT 0
  )`,
  // ── Agent registry and signed agent API (lib/agents/store.ts) ─────────────
  `CREATE TABLE IF NOT EXISTS agent_registry (
    agent_id        TEXT PRIMARY KEY,
    owner_wallet    TEXT NOT NULL,
    operator_wallet TEXT NOT NULL,
    payout_wallet   TEXT NOT NULL,
    display_name    TEXT NOT NULL DEFAULT '',
    authority_level SMALLINT NOT NULL DEFAULT 0,
    capabilities    TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'active',
    limits_json     TEXT NOT NULL DEFAULT '{}',
    created_at      BIGINT NOT NULL DEFAULT 0,
    updated_at      BIGINT NOT NULL DEFAULT 0,
    last_seen_at    BIGINT
  )`,
  `CREATE INDEX IF NOT EXISTS agent_registry_owner_idx ON agent_registry (owner_wallet)`,
  `CREATE INDEX IF NOT EXISTS agent_registry_operator_idx ON agent_registry (operator_wallet)`,
  // Only the SHA-256 of an API key is stored; the key itself is shown once.
  `CREATE TABLE IF NOT EXISTS agent_api_keys (
    key_hash   TEXT PRIMARY KEY,
    agent_id   TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    label      TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    revoked_at BIGINT
  )`,
  `CREATE INDEX IF NOT EXISTS agent_api_keys_agent_idx ON agent_api_keys (agent_id)`,
  // Single-use nonces. A replayed envelope is rejected on the primary key.
  `CREATE TABLE IF NOT EXISTS agent_api_nonces (
    nonce    TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    at       BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS agent_api_nonces_at_idx ON agent_api_nonces (at)`,
  // Stored responses make a retry with the same idempotency key safe.
  `CREATE TABLE IF NOT EXISTS agent_api_responses (
    idempotency_key TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL,
    action          TEXT NOT NULL,
    status          SMALLINT NOT NULL DEFAULT 200,
    response        TEXT NOT NULL,
    at              BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS agent_api_responses_at_idx ON agent_api_responses (at)`,
  // Every authenticated call; amount_units feeds the daily USDC cap.
  `CREATE TABLE IF NOT EXISTS agent_request_audit (
    id           BIGSERIAL PRIMARY KEY,
    agent_id     TEXT NOT NULL,
    action       TEXT NOT NULL,
    ok           BOOLEAN NOT NULL DEFAULT TRUE,
    reason       TEXT,
    amount_units BIGINT NOT NULL DEFAULT 0,
    at           BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS agent_request_audit_agent_at_idx ON agent_request_audit (agent_id, at DESC)`,
  // ── Agent baskets (lib/baskets-store.ts) ───────────────────────────────────
  // A basket holds nothing: these rows are a definition and a set of signed
  // intents (ed25519, base58), never a ledger of deposits.
  `CREATE TABLE IF NOT EXISTS baskets (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    thesis         TEXT NOT NULL DEFAULT '',
    creator_wallet TEXT NOT NULL,
    members_json   TEXT NOT NULL DEFAULT '[]',
    signature      TEXT NOT NULL DEFAULT '',
    created_at     BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS baskets_creator_idx ON baskets (creator_wallet)`,
  // updated_at is the signature's own signedAt: an older one is refused.
  `CREATE TABLE IF NOT EXISTS basket_subscriptions (
    basket_id           TEXT NOT NULL,
    follower            TEXT NOT NULL,
    per_market_cap_usdc NUMERIC NOT NULL DEFAULT 0,
    signature           TEXT NOT NULL DEFAULT '',
    updated_at          BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (basket_id, follower)
  )`,
  `CREATE INDEX IF NOT EXISTS basket_subscriptions_follower_idx ON basket_subscriptions (follower)`,
];

/** Changes whenever a schema statement does, so a deploy that edits DDL re-runs it. */
export const SCHEMA_FINGERPRINT = createHash("sha256")
  .update(JSON.stringify(SCHEMA_STATEMENTS))
  .digest("hex")
  .slice(0, 16);

declare global {
  // eslint-disable-next-line no-var
  var __mimirSolanaPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __mimirSolanaDbReady: Promise<Pool> | undefined;
}

export function isDbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Run the DDL once per schema version rather than on every cold start: one
 * SELECT on the hot path instead of every statement.
 */
async function ensureSchema(pool: Pool): Promise<void> {
  try {
    const res = await pool.query("SELECT value FROM schema_meta WHERE key = $1", ["schema_fingerprint"]);
    if (res.rows[0]?.value === SCHEMA_FINGERPRINT) return;
  } catch {
    // schema_meta does not exist yet: a fresh database, run everything.
  }
  for (const sql of SCHEMA_STATEMENTS) {
    await pool.query(sql);
  }
  await pool.query(
    `INSERT INTO schema_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    ["schema_fingerprint", SCHEMA_FINGERPRINT],
  );
}

/** The shared pool with the schema in place. Throws when DATABASE_URL is unset. */
export async function getDb(): Promise<Pool> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!globalThis.__mimirSolanaPool) {
    globalThis.__mimirSolanaPool = new Pool({ connectionString: url });
  }
  if (!globalThis.__mimirSolanaDbReady) {
    const pool = globalThis.__mimirSolanaPool;
    globalThis.__mimirSolanaDbReady = ensureSchema(pool).then(
      () => pool,
      (err) => {
        // Do not cache the failure: the next call retries instead of every
        // request on this instance failing until it is recycled.
        globalThis.__mimirSolanaDbReady = undefined;
        throw err;
      },
    );
  }
  return globalThis.__mimirSolanaDbReady;
}

/** Run one parameterized statement (`$1, $2, ...` placeholders) and return its rows. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  args: readonly unknown[] = [],
): Promise<T[]> {
  const pool = await getDb();
  const res = await pool.query(sql, args as unknown[]);
  return res.rows as T[];
}

export async function getMeta(key: string): Promise<string | null> {
  const rows = await query<{ value: string }>("SELECT value FROM app_meta WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string, now = Date.now()): Promise<void> {
  await query(
    `INSERT INTO app_meta (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now],
  );
}
