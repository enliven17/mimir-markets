/**
 * Persistence for the agent registry, its keys, nonces and audit trail.
 *
 * Everything here lives in the backend (lib/server/store.ts); there is no
 * in-memory fallback, because an agent registry that forgets its own
 * revocations on restart would be worse than no registry. Without the backend
 * every call throws and the API answers 503.
 *
 * Tables: agent_registry (key agent_id; i1 owner wallet, i2 operator wallet),
 * agent_api_keys (key hash; i1 agent), agent_api_nonces and agent_api_responses
 * (key agent:value), agent_request_audit (one row per call; i1 agent) and
 * agent_budget (one row per agent: the trailing day's stake reservations).
 */
import { randomBytes } from "node:crypto";

import { insert, store, StoreConflict, update } from "@/lib/server/store";
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

type Row = Record<string, unknown>;
const agentRow = (agentId: string) => store().get<Row>("agent_registry", agentId);
/** Patch an agent's row, keeping its lookup columns current. */
async function patchAgent(agentId: string, set: Row): Promise<void> {
  const prev = await agentRow(agentId);
  if (!prev) return;
  const next = { ...prev, ...set };
  await update("agent_registry", agentId, set, undefined, { i1: String(next.owner_wallet), i2: String(next.operator_wallet) });
}

export async function getAgent(agentId: string): Promise<AgentRecord | null> {
  const row = await agentRow(agentId);
  return row ? toRecord(row) : null;
}

/** Every agent row (the registry is small: hundreds at most). */
export async function allAgentRows(): Promise<Row[]> {
  return store().list<Row>("agent_registry", { limit: 5000 });
}

export async function listAgents(limit = 100): Promise<AgentRecord[]> {
  return (await allAgentRows())
    .filter((r) => r.status !== "revoked")
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
    .slice(0, limit)
    .map(toRecord);
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

/** Throws when the agent id is taken. */
export async function createAgent(input: CreateAgentInput, now = Date.now()): Promise<AgentRecord> {
  const row = {
    agent_id: input.agentId,
    owner_wallet: input.ownerWallet,
    operator_wallet: input.operatorWallet,
    payout_wallet: input.payoutWallet,
    display_name: input.displayName,
    authority_level: input.authorityLevel,
    capabilities: input.capabilities.join(","),
    status: input.status ?? "active",
    limits_json: JSON.stringify(defaultLimits()),
    created_at: now,
    updated_at: now,
    last_seen_at: null,
    arc_operator: input.arcOperator ?? null,
    chat_url: null,
    chat_price_units: 0,
    chat_secret: null,
    bio: "",
  };
  try {
    await store().tx([{ op: "insert", t: "agent_registry", k: input.agentId, d: row, i1: input.ownerWallet, i2: input.operatorWallet, at: now, must: true }]);
  } catch (err) {
    if (err instanceof StoreConflict) throw new Error(`agent ${input.agentId} already exists`);
    throw err;
  }
  return toRecord(row);
}

export async function setAgentStatus(agentId: string, status: AgentStatus, now = Date.now()): Promise<void> {
  await patchAgent(agentId, { status, updated_at: now, ...(status === "revoked" ? { capabilities: "" } : {}) });
}

export async function rotateOperator(agentId: string, operatorWallet: string, now = Date.now()): Promise<void> {
  await patchAgent(agentId, { operator_wallet: operatorWallet, updated_at: now });
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
  const prev = await agentRow(agentId);
  const fresh = chat.url !== "" && (!prev?.chat_secret || prev.chat_url !== chat.url);
  const secret = fresh ? randomBytes(32).toString("base64url") : null;
  await patchAgent(agentId, { chat_url: chat.url || null, chat_price_units: chat.priceUnits, bio: chat.bio, updated_at: now, ...(fresh ? { chat_secret: secret } : {}) });
  return { secret };
}

/** Where to relay a terminal message for this agent, or null when its chat is off. Server-only. */
export async function agentChatTarget(
  agentId: string,
): Promise<{ url: string; secret: string; priceUnits: number; payoutWallet: string } | null> {
  const r = await agentRow(agentId);
  if (!r || r.status !== "active" || !r.chat_url || !r.chat_secret) return null;
  return { url: String(r.chat_url), secret: String(r.chat_secret), priceUnits: Number(r.chat_price_units ?? 0), payoutWallet: String(r.payout_wallet) };
}

export async function touchAgent(agentId: string, now = Date.now()): Promise<void> {
  await update("agent_registry", agentId, { last_seen_at: now });
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
  await insert(
    "agent_api_keys",
    row.keyHash,
    { key_hash: row.keyHash, agent_id: row.agentId, key_prefix: row.keyPrefix, label: row.label, created_at: row.createdAt, revoked_at: null },
    { i1: row.agentId, at: row.createdAt },
  );
}

type KeyRow = { key_hash: string; agent_id: string; key_prefix: string; label: string; created_at: number; revoked_at: number | null };

export async function listApiKeys(agentId: string): Promise<ApiKeyRow[]> {
  const rows = await store().list<KeyRow>("agent_api_keys", { i1: agentId });
  return rows
    .sort((a, b) => b.created_at - a.created_at)
    .map((r) => ({
      keyHash: r.key_hash,
      agentId: r.agent_id,
      keyPrefix: r.key_prefix,
      label: r.label ?? "",
      createdAt: Number(r.created_at ?? 0),
      revokedAt: r.revoked_at == null ? null : Number(r.revoked_at),
    }));
}

/** Resolve a presented key to its agent. Revoked keys resolve to nothing. */
export async function agentIdForKeyHash(keyHash: string): Promise<string | null> {
  const r = await store().get<KeyRow>("agent_api_keys", keyHash);
  return r && r.revoked_at == null ? r.agent_id : null;
}

export async function revokeApiKey(agentId: string, keyPrefix: string, now = Date.now()): Promise<number> {
  const live = (await store().list<KeyRow>("agent_api_keys", { i1: agentId })).filter((r) => r.key_prefix === keyPrefix && r.revoked_at == null);
  if (!live.length) return 0;
  const res = await store().tx(live.map((r) => ({ op: "update" as const, t: "agent_api_keys", k: r.key_hash, d: { revoked_at: now }, when: { revoked_at: null } })));
  return res.filter(Boolean).length;
}

export async function revokeAllApiKeys(agentId: string, now = Date.now()): Promise<void> {
  const live = (await store().list<KeyRow>("agent_api_keys", { i1: agentId })).filter((r) => r.revoked_at == null);
  if (live.length) await store().tx(live.map((r) => ({ op: "update" as const, t: "agent_api_keys", k: r.key_hash, d: { revoked_at: now }, when: { revoked_at: null } })));
}

// ── Nonces, idempotency, audit ──────────────────────────────────────────────

/** Returns false when the nonce was already used. Atomic: the first insert of the key wins. */
export async function consumeNonce(agentId: string, nonce: string, now = Date.now()): Promise<boolean> {
  return insert("agent_api_nonces", `${agentId}:${nonce}`, { agent_id: agentId, at: now }, { at: now });
}

/** Nonces only need to outlive the envelope skew window. */
export async function pruneNonces(olderThanMs: number, now = Date.now()): Promise<void> {
  await store().prune("agent_api_nonces", now - olderThanMs);
}

/**
 * Housekeeping for the append-only agent tables. The backend also sweeps nonces and stored answers on its own
 * (convex/appStore.ts sweep); the audit trail is kept a month (the budget checks only ever look back a day).
 */
export async function pruneAgentTables(now = Date.now()): Promise<void> {
  await pruneNonces(3_600_000, now);
  await store().prune("agent_api_responses", now - 86_400_000);
  await store().prune("agent_request_audit", now - 30 * 86_400_000);
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

type StoredRow = { agent_id: string; action: string; status: number; response: string };

export async function getStoredResponse(
  agentId: string,
  idempotencyKey: string,
  action: string,
): Promise<StoredResponse | null> {
  const r = await store().get<StoredRow>("agent_api_responses", `${agentId}:${idempotencyKey}`);
  if (!r || r.agent_id !== agentId || r.action !== action) return null;
  try {
    return { status: Number(r.status ?? 200), body: JSON.parse(String(r.response)) };
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
  await insert("agent_api_responses", `${agentId}:${idempotencyKey}`, { agent_id: agentId, action, status, response: JSON.stringify(body), at: now }, { at: now });
}

type AuditRow = { id: string; agent_id: string; action: string; ok: boolean; reason: string | null; amount_units: string; at: number };

const auditId = () => randomBytes(9).toString("base64url");

export async function recordRequest(
  agentId: string,
  action: string,
  ok: boolean,
  reason: string | null,
  amountUnits = 0n,
  now = Date.now(),
): Promise<void> {
  const id = auditId();
  await insert("agent_request_audit", id, { id, agent_id: agentId, action, ok, reason, amount_units: amountUnits.toString(), at: now }, { i1: agentId, at: now });
}

/** The trailing day's stake reservations of one agent, kept in one row so a check-and-reserve is one compare-and-set. */
type Budget = { agent_id: string; version: number; entries: Array<{ id: string; units: string; at: number }> };

const DAY = 86_400_000;
const sumUnits = (entries: Budget["entries"]) => entries.reduce((s, e) => s + BigInt(e.units), 0n);

/**
 * The daily-cap check and its record as one step (audit P2-10): the reservation goes in only when the trailing 24h
 * staked units plus `amountUnits` stay within `maxDailyUnits`, by a compare-and-set on the agent's budget row, so
 * two concurrent requests can never both read the old total and overspend (the loser retries on the new total).
 * Returns the reservation id (to release it if the prepare fails), or null when the cap would be exceeded.
 */
export async function reserveDailyStake(
  agentId: string,
  action: string,
  amountUnits: bigint,
  maxDailyUnits: bigint,
  now = Date.now(),
): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const budget = (await store().get<Budget>("agent_budget", agentId)) ?? { agent_id: agentId, version: 0, entries: [] };
    const live = budget.entries.filter((e) => e.at > now - DAY);
    if (sumUnits(live) + amountUnits > maxDailyUnits) return null;
    const id = auditId();
    const next: Budget = { agent_id: agentId, version: budget.version + 1, entries: [...live, { id, units: amountUnits.toString(), at: now }] };
    try {
      await store().tx([
        budget.version === 0
          ? { op: "insert", t: "agent_budget", k: agentId, d: next, at: now, must: true }
          : { op: "update", t: "agent_budget", k: agentId, d: next, when: { version: budget.version }, must: true },
        { op: "insert", t: "agent_request_audit", k: id, d: { id, agent_id: agentId, action, ok: true, reason: null, amount_units: amountUnits.toString(), at: now }, i1: agentId, at: now },
      ]);
      return id;
    } catch (err) {
      if (!(err instanceof StoreConflict)) throw err;
    }
  }
  throw new Error("the agent's budget is busy; try again");
}

/** Undo a reservation whose transaction was never handed out (prepare failed). */
export async function releaseStake(id: string | number, reason: string): Promise<void> {
  const audit = await store().get<AuditRow>("agent_request_audit", String(id));
  if (!audit) return;
  await update("agent_request_audit", String(id), { ok: false, reason });
  for (let attempt = 0; attempt < 5; attempt++) {
    const budget = await store().get<Budget>("agent_budget", audit.agent_id);
    if (!budget || !budget.entries.some((e) => e.id === String(id))) return;
    const ok = await update(
      "agent_budget",
      audit.agent_id,
      { version: budget.version + 1, entries: budget.entries.filter((e) => e.id !== String(id)) },
      { version: budget.version },
    );
    if (ok) return;
  }
}

async function recentCalls(agentId: string, since: number): Promise<AuditRow[]> {
  return (await store().list<AuditRow>("agent_request_audit", { i1: agentId, limit: 5000 })).filter((r) => r.at > since);
}

/** Only allowed calls count: failures are anyone's to send and must not rate-limit the agent. */
export async function requestsLastHour(agentId: string, now = Date.now()): Promise<number> {
  return (await recentCalls(agentId, now - 3_600_000)).filter((r) => r.ok).length;
}

/**
 * USDC base units this agent was handed staking transactions for in the
 * trailing 24 hours. Counted when the unsigned transaction is issued, not when
 * it lands, so the daily cap errs on the safe side.
 */
export async function stakedLastDayUnits(agentId: string, now = Date.now()): Promise<bigint> {
  const budget = await store().get<Budget>("agent_budget", agentId);
  return budget ? sumUnits(budget.entries.filter((e) => e.at > now - DAY)) : 0n;
}

// ── Positions on the retired Solana program ─────────────────────────────────

export interface IndexedPosition {
  id: number;
  state: number;
  deadline: number;
  creator: string;
  stake: string;
}

/** Solana-era read index, retired with Postgres: Arc positions come from the backend index (lib/agents/arc-chain.ts). */
export async function claimsCreatedBy(_wallet: string, _limit = 100): Promise<IndexedPosition[]> {
  return [];
}

/** Solana-era read index, retired with Postgres. */
export async function claimsChallengedBy(_wallet: string, _limit = 100): Promise<IndexedPosition[]> {
  return [];
}

/** Set (or change) the EVM address an agent sends its Arc transactions from. */
export async function setArcOperator(agentId: string, arcOperator: string, now = Date.now()): Promise<void> {
  await patchAgent(agentId, { arc_operator: arcOperator, updated_at: now });
}

/** The agent whose Arc operator is `address` (any case), or null. */
export async function agentByArcOperator(address: string): Promise<AgentRecord | null> {
  const a = address.toLowerCase();
  const row = (await allAgentRows()).find((r) => typeof r.arc_operator === "string" && r.arc_operator.toLowerCase() === a);
  return row ? toRecord(row) : null;
}
