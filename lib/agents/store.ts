/**
 * Persistence for the agent registry, its keys, nonces and audit trail.
 *
 * Everything here is Postgres (lib/server/db.ts); there is no in-memory
 * fallback, because an agent registry that forgets its own revocations on
 * restart would be worse than no registry. Without DATABASE_URL every call
 * throws and the API answers 503.
 *
 * No "server-only" guard: the worker process imports `pruneAgentTables`, and
 * the guard throws outside the Next bundler. DATABASE_URL is never public.
 */
import { randomBytes } from "node:crypto";

import { getDb, query } from "@/lib/server/db";
import { MIMIR_PROGRAM_ID } from "@/lib/solana/config";
import {
  defaultLimits,
  isCapability,
  type AgentCapability,
  type AgentLimits,
  type AgentRecord,
  type AgentStatus,
  type AuthorityLevel,
} from "./registry";

function toRecord(row: Record<string, unknown>): AgentRecord {
  const capabilities = String(row.capabilities ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(isCapability);
  let limits: AgentLimits;
  try {
    limits = { ...defaultLimits(), ...(JSON.parse(String(row.limits_json ?? "{}")) as Partial<AgentLimits>) };
  } catch {
    limits = defaultLimits();
  }
  return {
    agentId: String(row.agent_id),
    ownerWallet: String(row.owner_wallet),
    operatorWallet: String(row.operator_wallet),
    arcOperator: typeof row.arc_operator === "string" && row.arc_operator ? (row.arc_operator as `0x${string}`) : null,
    payoutWallet: String(row.payout_wallet),
    displayName: String(row.display_name ?? ""),
    authorityLevel: Number(row.authority_level ?? 0) as AuthorityLevel,
    capabilities,
    status: String(row.status ?? "active") as AgentStatus,
    limits,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    lastSeenAt: row.last_seen_at === null || row.last_seen_at === undefined ? null : Number(row.last_seen_at),
    chat: {
      enabled: typeof row.chat_url === "string" && row.chat_url !== "",
      priceUnits: Number(row.chat_price_units ?? 0),
      bio: String(row.bio ?? ""),
    },
  };
}

export async function getAgent(agentId: string): Promise<AgentRecord | null> {
  const rows = await query("SELECT * FROM agent_registry WHERE agent_id = $1", [agentId]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listAgents(limit = 100): Promise<AgentRecord[]> {
  const rows = await query(
    "SELECT * FROM agent_registry WHERE status <> 'revoked' ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return rows.map(toRecord);
}

export interface CreateAgentInput {
  agentId: string;
  ownerWallet: string;
  operatorWallet: string;
  payoutWallet: string;
  displayName: string;
  authorityLevel: AuthorityLevel;
  capabilities: AgentCapability[];
  status?: AgentStatus;
  arcOperator?: string | null;
}

export async function createAgent(input: CreateAgentInput, now = Date.now()): Promise<AgentRecord> {
  const limits = defaultLimits();
  await query(
    `INSERT INTO agent_registry
       (agent_id, owner_wallet, operator_wallet, payout_wallet, display_name,
        authority_level, capabilities, status, limits_json, created_at, updated_at, arc_operator)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.agentId,
      input.ownerWallet,
      input.operatorWallet,
      input.payoutWallet,
      input.displayName,
      input.authorityLevel,
      input.capabilities.join(","),
      input.status ?? "active",
      JSON.stringify(limits),
      now,
      now,
      input.arcOperator ?? null,
    ],
  );
  const created = await getAgent(input.agentId);
  if (!created) throw new Error("agent insert did not persist");
  return created;
}

export async function setAgentStatus(agentId: string, status: AgentStatus, now = Date.now()): Promise<void> {
  const clearCapabilities = status === "revoked";
  await query(
    `UPDATE agent_registry
        SET status = $1, updated_at = $2${clearCapabilities ? ", capabilities = ''" : ""}
      WHERE agent_id = $3`,
    [status, now, agentId],
  );
}

export async function rotateOperator(agentId: string, operatorWallet: string, now = Date.now()): Promise<void> {
  await query("UPDATE agent_registry SET operator_wallet = $1, updated_at = $2 WHERE agent_id = $3", [
    operatorWallet,
    now,
    agentId,
  ]);
}

/**
 * Point an agent's terminal chat at `url` (or "" to turn it off). A new secret
 * is minted when the URL changes or none exists yet; it is returned once and
 * the endpoint verifies every request with it. Null secret: unchanged.
 */
export async function setAgentChat(
  agentId: string,
  chat: { url: string; priceUnits: number; bio: string },
  now = Date.now(),
): Promise<{ secret: string | null }> {
  const rows = await query<{ chat_url: string | null; chat_secret: string | null }>(
    "SELECT chat_url, chat_secret FROM agent_registry WHERE agent_id = $1",
    [agentId],
  );
  const prev = rows[0];
  const fresh = chat.url !== "" && (!prev?.chat_secret || prev.chat_url !== chat.url);
  const secret = fresh ? randomBytes(32).toString("base64url") : null;
  await query(
    `UPDATE agent_registry
        SET chat_url = $2, chat_price_units = $3, bio = $4, updated_at = $5${fresh ? ", chat_secret = $6" : ""}
      WHERE agent_id = $1`,
    fresh ? [agentId, chat.url || null, chat.priceUnits, chat.bio, now, secret] : [agentId, chat.url || null, chat.priceUnits, chat.bio, now],
  );
  return { secret };
}

/** Where to relay a terminal message for this agent, or null when its chat is off. Server-only. */
export async function agentChatTarget(
  agentId: string,
): Promise<{ url: string; secret: string; priceUnits: number; payoutWallet: string } | null> {
  const rows = await query<{ chat_url: string | null; chat_secret: string | null; chat_price_units: string | number; status: string; payout_wallet: string }>(
    "SELECT chat_url, chat_secret, chat_price_units, status, payout_wallet FROM agent_registry WHERE agent_id = $1",
    [agentId],
  );
  const r = rows[0];
  if (!r || r.status !== "active" || !r.chat_url || !r.chat_secret) return null;
  return { url: r.chat_url, secret: r.chat_secret, priceUnits: Number(r.chat_price_units ?? 0), payoutWallet: r.payout_wallet };
}

export async function touchAgent(agentId: string, now = Date.now()): Promise<void> {
  await query("UPDATE agent_registry SET last_seen_at = $1 WHERE agent_id = $2", [now, agentId]);
}

// ── API keys ────────────────────────────────────────────────────────────────

export interface ApiKeyRow {
  keyHash: string;
  agentId: string;
  keyPrefix: string;
  label: string;
  createdAt: number;
  revokedAt: number | null;
}

export async function insertApiKey(row: Omit<ApiKeyRow, "revokedAt">): Promise<void> {
  await query(
    "INSERT INTO agent_api_keys(key_hash, agent_id, key_prefix, label, created_at) VALUES ($1, $2, $3, $4, $5)",
    [row.keyHash, row.agentId, row.keyPrefix, row.label, row.createdAt],
  );
}

export async function listApiKeys(agentId: string): Promise<ApiKeyRow[]> {
  const rows = await query("SELECT * FROM agent_api_keys WHERE agent_id = $1 ORDER BY created_at DESC", [agentId]);
  return rows.map((r) => ({
    keyHash: String(r.key_hash),
    agentId: String(r.agent_id),
    keyPrefix: String(r.key_prefix),
    label: String(r.label ?? ""),
    createdAt: Number(r.created_at ?? 0),
    revokedAt: r.revoked_at === null || r.revoked_at === undefined ? null : Number(r.revoked_at),
  }));
}

/** Resolve a presented key to its agent. Revoked keys resolve to nothing. */
export async function agentIdForKeyHash(keyHash: string): Promise<string | null> {
  const rows = await query(
    "SELECT agent_id FROM agent_api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [keyHash],
  );
  return rows[0] ? String(rows[0].agent_id) : null;
}

export async function revokeApiKey(agentId: string, keyPrefix: string, now = Date.now()): Promise<number> {
  const rows = await query(
    `UPDATE agent_api_keys SET revoked_at = $1
      WHERE agent_id = $2 AND key_prefix = $3 AND revoked_at IS NULL
      RETURNING key_hash`,
    [now, agentId, keyPrefix],
  );
  return rows.length;
}

export async function revokeAllApiKeys(agentId: string, now = Date.now()): Promise<void> {
  await query("UPDATE agent_api_keys SET revoked_at = $1 WHERE agent_id = $2 AND revoked_at IS NULL", [
    now,
    agentId,
  ]);
}

// ── Nonces, idempotency, audit ──────────────────────────────────────────────

/** Returns false when the nonce was already used. Atomic: the primary key decides. */
export async function consumeNonce(agentId: string, nonce: string, now = Date.now()): Promise<boolean> {
  const rows = await query(
    "INSERT INTO agent_api_nonces(nonce, agent_id, at) VALUES ($1, $2, $3) ON CONFLICT (nonce) DO NOTHING RETURNING nonce",
    [`${agentId}:${nonce}`, agentId, now],
  );
  return rows.length > 0;
}

/** Nonces only need to outlive the envelope skew window. */
export async function pruneNonces(olderThanMs: number, now = Date.now()): Promise<void> {
  await query("DELETE FROM agent_api_nonces WHERE at < $1", [now - olderThanMs]);
}

/**
 * Housekeeping for the append-only agent tables, run by the worker process
 * next to the rate-limit prune. Nonces outlive the 5 minute skew window by a
 * wide margin, idempotent answers are kept a day, and the audit trail a month
 * (the budget checks only ever look back a day).
 */
export async function pruneAgentTables(now = Date.now()): Promise<void> {
  await pruneNonces(3_600_000, now);
  await query("DELETE FROM agent_api_responses WHERE at < $1", [now - 86_400_000]);
  await query("DELETE FROM agent_request_audit WHERE at < $1", [now - 30 * 86_400_000]);
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

export async function getStoredResponse(
  agentId: string,
  idempotencyKey: string,
  action: string,
): Promise<StoredResponse | null> {
  const rows = await query(
    "SELECT status, response FROM agent_api_responses WHERE idempotency_key = $1 AND agent_id = $2 AND action = $3",
    [`${agentId}:${idempotencyKey}`, agentId, action],
  );
  if (!rows[0]) return null;
  try {
    return { status: Number(rows[0].status ?? 200), body: JSON.parse(String(rows[0].response)) };
  } catch {
    return null;
  }
}

export async function storeResponse(
  agentId: string,
  idempotencyKey: string,
  action: string,
  status: number,
  body: unknown,
  now = Date.now(),
): Promise<void> {
  await query(
    `INSERT INTO agent_api_responses(idempotency_key, agent_id, action, status, response, at)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (idempotency_key) DO NOTHING`,
    [`${agentId}:${idempotencyKey}`, agentId, action, status, JSON.stringify(body), now],
  );
}

export async function recordRequest(
  agentId: string,
  action: string,
  ok: boolean,
  reason: string | null,
  amountUnits = 0n,
  now = Date.now(),
): Promise<void> {
  await query(
    "INSERT INTO agent_request_audit(agent_id, action, ok, reason, amount_units, at) VALUES ($1, $2, $3, $4, $5, $6)",
    [agentId, action, ok, reason, amountUnits.toString(), now],
  );
}

/**
 * The daily-cap check and its record as one step (audit P2-10): under a
 * per-agent advisory lock, insert the allowed request only when the trailing
 * 24h staked units plus `amountUnits` stay within `maxDailyUnits`. Two
 * concurrent requests can no longer both read the old total and overspend.
 * Returns the audit row id (to release it if the prepare fails), or null
 * when the cap would be exceeded.
 */
export async function reserveDailyStake(
  agentId: string,
  action: string,
  amountUnits: bigint,
  maxDailyUnits: bigint,
  now = Date.now(),
): Promise<number | null> {
  const pool = await getDb();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The INSERT below runs after the lock is held, so (READ COMMITTED) it
    // sees every reservation committed by a request that held it before.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`agent-budget:${agentId}`]);
    const res = await client.query(
      `INSERT INTO agent_request_audit(agent_id, action, ok, reason, amount_units, at)
       SELECT $1, $2, TRUE, NULL, $3::bigint, $4
        WHERE (SELECT COALESCE(SUM(amount_units), 0) FROM agent_request_audit
                WHERE agent_id = $1 AND ok AND at > $5) + $3::bigint <= $6::bigint
       RETURNING id`,
      [agentId, action, amountUnits.toString(), now, now - 86_400_000, maxDailyUnits.toString()],
    );
    await client.query("COMMIT");
    const id = res.rows[0]?.id;
    return id === undefined ? null : Number(id);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Undo a reservation whose transaction was never handed out (prepare failed). */
export async function releaseStake(id: number, reason: string): Promise<void> {
  await query("UPDATE agent_request_audit SET ok = FALSE, reason = $2 WHERE id = $1", [id, reason]);
}

/** Only allowed calls count: failures are anyone's to send and must not rate-limit the agent. */
export async function requestsLastHour(agentId: string, now = Date.now()): Promise<number> {
  const rows = await query(
    "SELECT COUNT(*) AS n FROM agent_request_audit WHERE agent_id = $1 AND ok AND at > $2",
    [agentId, now - 3_600_000],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * USDC base units this agent was handed staking transactions for in the
 * trailing 24 hours. Counted when the unsigned transaction is issued, not when
 * it lands, so the daily cap errs on the safe side.
 */
export async function stakedLastDayUnits(agentId: string, now = Date.now()): Promise<bigint> {
  const rows = await query(
    "SELECT COALESCE(SUM(amount_units), 0) AS n FROM agent_request_audit WHERE agent_id = $1 AND ok AND at > $2",
    [agentId, now - 86_400_000],
  );
  return BigInt(String(rows[0]?.n ?? "0"));
}

// ── Positions (read index, lib/server/solana-index.ts; scoped per program) ──

export interface IndexedPosition {
  id: number;
  state: number;
  deadline: number;
  creator: string;
  stake: string;
}

/** Claims this wallet opened, newest first. Empty when the indexer has not run. */
export async function claimsCreatedBy(wallet: string, limit = 100): Promise<IndexedPosition[]> {
  const rows = await query(
    "SELECT id, state, deadline, creator, creator_stake FROM solana_claims WHERE program = $1 AND creator = $2 ORDER BY id DESC LIMIT $3",
    [MIMIR_PROGRAM_ID.toBase58(), wallet, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    state: Number(r.state),
    deadline: Number(r.deadline),
    creator: String(r.creator),
    stake: String(r.creator_stake ?? "0"),
  }));
}

/** Claims this wallet challenged, with its stake, newest first. */
export async function claimsChallengedBy(wallet: string, limit = 100): Promise<IndexedPosition[]> {
  const rows = await query(
    `SELECT c.id, c.state, c.deadline, c.creator, ch->>'stake' AS stake
       FROM solana_claims c, jsonb_array_elements(c.challengers) ch
      WHERE c.program = $1 AND ch->>'addr' = $2
      ORDER BY c.id DESC LIMIT $3`,
    [MIMIR_PROGRAM_ID.toBase58(), wallet, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    state: Number(r.state),
    deadline: Number(r.deadline),
    creator: String(r.creator),
    stake: String(r.stake ?? "0"),
  }));
}

/** Set (or change) the EVM address an agent sends its Arc transactions from. */
export async function setArcOperator(agentId: string, arcOperator: string, now = Date.now()): Promise<void> {
  await query("UPDATE agent_registry SET arc_operator = $1, updated_at = $2 WHERE agent_id = $3", [arcOperator, now, agentId]);
}
