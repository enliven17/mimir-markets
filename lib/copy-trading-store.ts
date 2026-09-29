/**
 * Persistence for copy permissions and the execution audit trail (Postgres,
 * lib/server/db.ts).
 *
 * Refused copies are recorded alongside executed ones: a log that only shows
 * what happened cannot answer the question a follower actually asks, which is
 * why their agent did not copy something. Wallets are base58 and stored
 * exactly as given.
 *
 * No "server-only" guard, matching lib/baskets-store.ts. Without DATABASE_URL
 * every call throws; routes catch and degrade.
 */
import { query } from "@/lib/server/db";
import { MIMIR_PROGRAM_ID, SIDE_CREATOR, ST_CANCELLED, ST_RESOLVED } from "@/lib/solana/config";
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
  const rows = await query(
    `INSERT INTO copy_permissions
       (id, follower, signal_agent_id, execution_agent_id, active, expires_at, policy_json, signature, signed_at, created_at)
     VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       active = TRUE,
       revoked_at = NULL,
       signal_agent_id = EXCLUDED.signal_agent_id,
       execution_agent_id = EXCLUDED.execution_agent_id,
       expires_at = EXCLUDED.expires_at,
       policy_json = EXCLUDED.policy_json,
       signature = EXCLUDED.signature,
       signed_at = EXCLUDED.signed_at
     WHERE copy_permissions.follower = EXCLUDED.follower
       AND copy_permissions.signed_at < EXCLUDED.signed_at
       AND (copy_permissions.revoked_at IS NULL OR copy_permissions.revoked_at < EXCLUDED.signed_at)
     RETURNING id`,
    [
      p.id,
      p.follower,
      p.signalAgentId,
      p.executionAgentId,
      p.expiresAt,
      JSON.stringify(policy),
      p.signature,
      p.signedAt,
      p.createdAt,
    ],
  );
  return rows.length > 0;
}

export async function listPermissions(follower: string): Promise<CopyPermission[]> {
  const rows = await query(
    "SELECT * FROM copy_permissions WHERE follower = $1 ORDER BY created_at DESC LIMIT 100",
    [follower],
  );
  return rows.map(toPermission);
}

export async function getPermission(id: string): Promise<CopyPermission | null> {
  const rows = await query("SELECT * FROM copy_permissions WHERE id = $1", [id]);
  return rows[0] ? toPermission(rows[0]) : null;
}

/**
 * Revocation is immediate and needs no countersignature. `at` is the signed
 * proof's timestamp: a revoke signed before the current grant does not cancel
 * it, so an old revoke proof cannot be replayed against fresh terms.
 */
export async function revokePermission(id: string, follower: string, at: number): Promise<number> {
  const rows = await query(
    `UPDATE copy_permissions SET active = FALSE, revoked_at = $3
      WHERE id = $1 AND follower = $2 AND revoked_at IS NULL AND signed_at < $3
      RETURNING id`,
    [id, follower, at],
  );
  return rows.length;
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
  const rows = await query(
    `INSERT INTO copy_executions(permission_id, claim_id, executed, skip_reason, stake_usdc, tx_signature, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      args.permissionId,
      args.claimId,
      args.executed,
      args.skipReason ?? null,
      args.stakeUsdc ?? 0,
      args.txSignature ?? null,
      now,
    ],
  );
  return rows.length > 0;
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
  const rows = await query(
    `SELECT claim_id, executed, skip_reason, stake_usdc, tx_signature, at
       FROM copy_executions WHERE permission_id = $1 ORDER BY at DESC LIMIT $2`,
    [permissionId, limit],
  );
  return rows.map((r) => ({
    claimId: Number(r.claim_id ?? 0),
    executed: Boolean(r.executed),
    skipReason: r.skip_reason === null || r.skip_reason === undefined ? null : String(r.skip_reason),
    stakeUsdc: Number(r.stake_usdc ?? 0),
    txSignature: r.tx_signature === null || r.tx_signature === undefined ? null : String(r.tx_signature),
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
export async function loadUsage(permissionId: string, now = Date.now()): Promise<CopyUsage> {
  const rows = await query(
    `SELECT e.claim_id, e.stake_usdc, e.at, c.state, c.winner_side
       FROM copy_executions e
       LEFT JOIN solana_claims c ON c.program = $2 AND c.id = e.claim_id
      WHERE e.permission_id = $1 AND e.executed`,
    [permissionId, MIMIR_PROGRAM_ID.toBase58()],
  );
  return usageFromPositions(
    rows.map((r) => ({
      claimId: Number(r.claim_id ?? 0),
      stakeUsdc: Number(r.stake_usdc ?? 0),
      at: Number(r.at ?? 0),
      state: r.state === null || r.state === undefined ? null : Number(r.state),
      winnerSide: Number(r.winner_side ?? 0),
    })),
    now,
  );
}

/** Active, unexpired permissions naming this agent as the executor. */
export async function permissionsForExecutor(executionAgentId: string, now = Date.now()): Promise<CopyPermission[]> {
  const rows = await query(
    `SELECT * FROM copy_permissions
      WHERE execution_agent_id = $1 AND active AND revoked_at IS NULL AND expires_at > $2
      ORDER BY created_at DESC
      LIMIT 50`,
    [executionAgentId, now],
  );
  return rows.map(toPermission);
}
