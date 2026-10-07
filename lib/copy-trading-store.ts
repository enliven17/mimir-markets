/**
 * Persistence for copy permissions and the execution audit trail (the backend,
 * lib/server/store.ts): copy_permissions (key id; i1 follower, i2 executor),
 * copy_executions (i1 permission; an executed copy is keyed permission:claim so
 * it is recorded once), copy_reservations (key permission:claim; i1 permission)
 * and copy_locks (one per permission, the compare-and-set that serialises cap
 * checks).
 *
 * Refused copies are recorded alongside executed ones: a log that only shows
 * what happened cannot answer the question a follower actually asks, which is
 * why their agent did not copy something. Wallets are base58 and stored
 * exactly as given.
 *
 * No "server-only" guard, matching lib/baskets-store.ts. Without the backend
 * every call throws; routes catch and degrade.
 */
import { randomBytes } from "node:crypto";

import { insert, remove, store, StoreConflict, update } from "@/lib/server/store";
import { SIDE_CREATOR, ST_CANCELLED, ST_RESOLVED } from "@/lib/solana/config";
import type { CopyPermission, CopySkipReason, CopyUsage } from "@/lib/copy-trading";

type PolicyFields = Pick<
  CopyPermission,
  | "maxPerPositionUsdc"
  | "maxDailyUsdc"
  | "maxWeeklyUsdc"
  | "maxOpenExposureUsdc"
  | "maxRealizedLossUsdc"
  | "allowedCategories"
  | "minClaimQuality"
  | "minPayoutRatio"
>;

function toPermission(r: Record<string, unknown>): CopyPermission {
  let policy: Partial<PolicyFields> = {};
  try {
    policy = JSON.parse(String(r.policy_json ?? "{}")) as Partial<PolicyFields>;
  } catch {
    policy = {};
  }
  return {
    id: String(r.id),
    follower: String(r.follower),
    signalAgentId: String(r.signal_agent_id),
    executionAgentId: String(r.execution_agent_id),
    active: Boolean(r.active) && (r.revoked_at === null || r.revoked_at === undefined),
    expiresAt: Number(r.expires_at ?? 0),
    maxPerPositionUsdc: Number(policy.maxPerPositionUsdc ?? 0),
    maxDailyUsdc: Number(policy.maxDailyUsdc ?? 0),
    maxWeeklyUsdc: Number(policy.maxWeeklyUsdc ?? 0),
    maxOpenExposureUsdc: Number(policy.maxOpenExposureUsdc ?? 0),
    maxRealizedLossUsdc: Number(policy.maxRealizedLossUsdc ?? 0),
    allowedCategories: Array.isArray(policy.allowedCategories) ? policy.allowedCategories : [],
    minClaimQuality: Number(policy.minClaimQuality ?? 0),
    minPayoutRatio: Number(policy.minPayoutRatio ?? 1),
    signedAt: Number(r.signed_at ?? 0),
    signature: String(r.signature ?? ""),
    createdAt: Number(r.created_at ?? 0),
  };
}

/**
 * Insert a grant, or supersede an existing one with the same id. The upsert
 * only lands when the row belongs to the same follower, this signature is
 * newer than the one on file, and it was signed after any revocation, so a
 * replayed old grant can neither overwrite new terms nor revive a revoked
 * permission. Returns false when nothing was written.
 */
export async function savePermission(p: CopyPermission): Promise<boolean> {
  const policy: PolicyFields = {
    maxPerPositionUsdc: p.maxPerPositionUsdc,
    maxDailyUsdc: p.maxDailyUsdc,
    maxWeeklyUsdc: p.maxWeeklyUsdc,
    maxOpenExposureUsdc: p.maxOpenExposureUsdc,
    maxRealizedLossUsdc: p.maxRealizedLossUsdc,
    allowedCategories: p.allowedCategories,
    minClaimQuality: p.minClaimQuality,
    minPayoutRatio: p.minPayoutRatio,
  };
  const row = {
    id: p.id,
    follower: p.follower,
    signal_agent_id: p.signalAgentId,
    execution_agent_id: p.executionAgentId,
    active: true,
    expires_at: p.expiresAt,
    policy_json: JSON.stringify(policy),
    signature: p.signature,
    signed_at: p.signedAt,
    created_at: p.createdAt,
    revoked_at: null,
  };
  const idx = { i1: p.follower, i2: p.executionAgentId, at: p.createdAt };
  const prev = await store().get<Record<string, unknown>>("copy_permissions", p.id);
  if (!prev) return insert("copy_permissions", p.id, row, idx);
  const prevRevoked = prev.revoked_at == null ? null : Number(prev.revoked_at);
  if (prev.follower !== p.follower || Number(prev.signed_at) >= p.signedAt || (prevRevoked !== null && prevRevoked >= p.signedAt)) return false;
  const { created_at: _keep, ...changes } = row;
  // Compare-and-set on what was checked: a grant or revoke that landed in between makes this a no-op.
  return update("copy_permissions", p.id, changes, { signed_at: prev.signed_at, revoked_at: prevRevoked }, idx);
}

type PermRow = Record<string, unknown>;

export async function listPermissions(follower: string): Promise<CopyPermission[]> {
  const rows = await store().list<PermRow>("copy_permissions", { i1: follower, limit: 100 });
  return rows.sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0)).map(toPermission);
}

export async function getPermission(id: string): Promise<CopyPermission | null> {
  const row = await store().get<PermRow>("copy_permissions", id);
  return row ? toPermission(row) : null;
}

/**
 * Revocation is immediate and needs no countersignature. `at` is the signed
 * proof's timestamp: a revoke signed before the current grant does not cancel
 * it, so an old revoke proof cannot be replayed against fresh terms.
 */
export async function revokePermission(id: string, follower: string, at: number): Promise<number> {
  const prev = await store().get<PermRow>("copy_permissions", id);
  if (!prev || prev.follower !== follower || prev.revoked_at != null || Number(prev.signed_at) >= at) return 0;
  return (await update("copy_permissions", id, { active: false, revoked_at: at }, { revoked_at: null, signed_at: prev.signed_at })) ? 1 : 0;
}

/**
 * How long a prepared copy counts against the follower's limits without a
 * report: the whole weekly limit window, so an executor that never reports
 * cannot get the spend back by waiting (a report releases it at once).
 */
export const COPY_RESERVATION_TTL_MS = 7 * 86_400_000;

type ExecRow = { permission_id: string; claim_id: number; executed: boolean; skip_reason: string | null; stake_usdc: number; tx_signature: string | null; at: number };
type ResRow = { permission_id: string; claim_id: number; stake_usdc: number; at: number; expires_at: number };

/** Executed copies plus live reservations whose copy has not been reported executed. */
async function ledger(permissionId: string, now: number): Promise<Array<{ claimId: number; stakeUsdc: number; at: number }>> {
  const [execs, reservations] = await Promise.all([
    store().list<ExecRow>("copy_executions", { i1: permissionId, limit: 5000 }),
    store().list<ResRow>("copy_reservations", { i1: permissionId, limit: 5000 }),
  ]);
  const executed = execs.filter((e) => e.executed);
  const done = new Set(executed.map((e) => Number(e.claim_id)));
  return [
    ...executed.map((e) => ({ claimId: Number(e.claim_id), stakeUsdc: Number(e.stake_usdc ?? 0), at: Number(e.at) })),
    ...reservations
      .filter((r) => r.expires_at > now && !done.has(Number(r.claim_id)))
      .map((r) => ({ claimId: Number(r.claim_id), stakeUsdc: Number(r.stake_usdc ?? 0), at: Number(r.at) })),
  ];
}

const spentSince = (rows: Array<{ stakeUsdc: number; at: number }>, since: number) =>
  rows.filter((r) => r.at > since).reduce((s, r) => s + r.stakeUsdc, 0);

/**
 * Provisional spend written when a copy transaction is prepared (audit
 * P2-11): until the executor reports, the follower's caps count it. The cap
 * check and the write are a compare-and-set on the permission's lock row, so
 * two concurrent prepares (even for different claims) cannot both fit under
 * the same room: the second sees the lock moved and checks again.
 * "duplicate": a live reservation for this claim already exists.
 */
export async function reserveCopy(
  permissionId: string,
  claimId: number,
  stakeUsdc: number,
  caps: Pick<CopyPermission, "maxDailyUsdc" | "maxWeeklyUsdc">,
  now = Date.now(),
): Promise<"ok" | "duplicate" | "over_cap"> {
  const key = `${permissionId}:${claimId}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const lock = await store().get<{ version: number }>("copy_locks", permissionId);
    const existing = await store().get<ResRow>("copy_reservations", key);
    if (existing && existing.expires_at > now) return "duplicate";
    const rows = await ledger(permissionId, now);
    if (spentSince(rows, now - 86_400_000) + stakeUsdc > caps.maxDailyUsdc) return "over_cap";
    if (spentSince(rows, now - 7 * 86_400_000) + stakeUsdc > caps.maxWeeklyUsdc) return "over_cap";
    const version = lock?.version ?? 0;
    try {
      await store().tx([
        lock
          ? { op: "update", t: "copy_locks", k: permissionId, d: { version: version + 1 }, when: { version }, must: true }
          : { op: "insert", t: "copy_locks", k: permissionId, d: { version: 1 }, must: true },
        {
          op: "put",
          t: "copy_reservations",
          k: key,
          d: { permission_id: permissionId, claim_id: claimId, stake_usdc: stakeUsdc, at: now, expires_at: now + COPY_RESERVATION_TTL_MS },
          i1: permissionId,
          at: now,
        },
      ]);
      return "ok";
    } catch (err) {
      if (!(err instanceof StoreConflict)) throw err;
    }
  }
  throw new Error("the copy permission is busy; try again");
}

/** Drop a reservation once its copy is reported (either way) or never handed out. */
export async function releaseCopy(permissionId: string, claimId: number): Promise<void> {
  await remove("copy_reservations", `${permissionId}:${claimId}`);
}

/** Records one copy outcome. Returns false when an executed copy was already on file. */
export async function recordExecution(args: {
  permissionId: string;
  claimId: number;
  executed: boolean;
  skipReason?: CopySkipReason | null;
  stakeUsdc?: number;
  txSignature?: string | null;
}, now = Date.now()): Promise<boolean> {
  const row: ExecRow = {
    permission_id: args.permissionId,
    claim_id: args.claimId,
    executed: args.executed,
    skip_reason: args.skipReason ?? null,
    stake_usdc: args.stakeUsdc ?? 0,
    tx_signature: args.txSignature ?? null,
    at: now,
  };
  // One executed copy per claim per permission: a repeated report cannot double-count spend.
  const key = args.executed ? `${args.permissionId}:${args.claimId}:executed` : `${args.permissionId}:${args.claimId}:${randomBytes(6).toString("base64url")}`;
  return insert("copy_executions", key, row, { i1: args.permissionId, at: now });
}

export interface CopyExecutionRow {
  claimId: number;
  executed: boolean;
  skipReason: string | null;
  stakeUsdc: number;
  txSignature: string | null;
  at: number;
}

export async function listExecutions(permissionId: string, limit = 50): Promise<CopyExecutionRow[]> {
  const rows = await store().list<ExecRow>("copy_executions", { i1: permissionId, limit: 5000 });
  return rows
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((r) => ({
      claimId: Number(r.claim_id ?? 0),
      executed: Boolean(r.executed),
      skipReason: r.skip_reason ?? null,
      stakeUsdc: Number(r.stake_usdc ?? 0),
      txSignature: r.tx_signature ?? null,
      at: Number(r.at ?? 0),
    }));
}

/** One executed copy with the indexed state of the claim it went into. */
export interface CopiedPosition {
  claimId: number;
  stakeUsdc: number;
  at: number;
  /** null when the read index has not seen the claim. */
  state: number | null;
  winnerSide: number;
}

/**
 * Fold executed copies into usage. Pure, so the settlement rules are testable:
 *  - RESOLVED with a creator win: the copy sat on the challenger side, a total loss.
 *  - RESOLVED any other way, or CANCELLED: settled or refunded, no longer at risk.
 *  - anything else (OPEN, ACTIVE, PROPOSED, DISPUTED, unindexed): still at risk,
 *    the direction that protects the follower's ceiling.
 */
export function usageFromPositions(positions: CopiedPosition[], now = Date.now()): CopyUsage {
  const dayAgo = now - 24 * 3_600_000;
  const weekAgo = now - 7 * 24 * 3_600_000;
  const usage: CopyUsage = {
    spentTodayUsdc: 0,
    spentThisWeekUsdc: 0,
    openExposureUsdc: 0,
    realizedLossUsdc: 0,
    heldClaimIds: [],
  };
  for (const p of positions) {
    if (p.at > dayAgo) usage.spentTodayUsdc += p.stakeUsdc;
    if (p.at > weekAgo) usage.spentThisWeekUsdc += p.stakeUsdc;
    usage.heldClaimIds.push(p.claimId);
    if (p.state === ST_RESOLVED) {
      if (p.winnerSide === SIDE_CREATOR) usage.realizedLossUsdc += p.stakeUsdc;
    } else if (p.state !== ST_CANCELLED) {
      usage.openExposureUsdc += p.stakeUsdc;
    }
  }
  return usage;
}

/**
 * What a permission has already spent and has at risk, derived from the
 * ledger rather than a running total: a counter that drifts out of sync with
 * the rows silently raises somebody's ceiling.
 */
export async function loadUsage(
  permissionId: string,
  now = Date.now(),
  /** The state and winner of the markets copied into (the Arc index); unknown markets count as still at risk. */
  stateOf: (claimIds: number[]) => Promise<Map<number, { state: number; winnerSide: number }>> = async () => new Map(),
): Promise<CopyUsage> {
  // Executed copies plus prepared ones not yet reported (and not expired).
  const rows = await ledger(permissionId, now);
  const states = await stateOf([...new Set(rows.map((r) => r.claimId))]).catch(() => new Map<number, { state: number; winnerSide: number }>());
  return usageFromPositions(
    rows.map((r) => {
      const s = states.get(r.claimId);
      return { ...r, state: s ? s.state : null, winnerSide: s?.winnerSide ?? 0 };
    }),
    now,
  );
}

/** Active, unexpired permissions naming this agent as the executor. */
export async function permissionsForExecutor(executionAgentId: string, now = Date.now()): Promise<CopyPermission[]> {
  const rows = await store().list<PermRow>("copy_permissions", { i2: executionAgentId, limit: 500 });
  return rows
    .filter((r) => r.active && r.revoked_at == null && Number(r.expires_at) > now)
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
    .slice(0, 50)
    .map(toPermission);
}
