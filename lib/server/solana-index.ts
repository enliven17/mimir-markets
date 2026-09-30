// Shared by the Next.js API route (server) and the indexer worker (Node).
// No "server-only" guard: that throws outside the Next bundler. DATABASE_URL
// is never NEXT_PUBLIC_, so it can't leak to the client regardless.
import { getDb, isDbEnabled } from "./db";
import { MIMIR_PROGRAM_ID } from "../solana/config";

/** Rows are scoped to the configured program: a redeploy restarts claim ids at 1. */
const PROGRAM = () => MIMIR_PROGRAM_ID.toBase58();

/**
 * Solana read-index: a denormalized cache of on-chain claim state in Neon
 * Postgres. The Mimir program is the source of truth; this table is a fast,
 * filterable mirror that the indexer worker keeps fresh.
 *
 * Why: /api/arena/claims would otherwise re-read every claim from both the
 * Ephemeral Rollup and the base layer on every poll. That doesn't scale and
 * hammers the public devnet RPC (429s). The indexer writes once per cycle;
 * the feed reads one SQL query.
 */

export function isIndexEnabled(): boolean {
  return isDbEnabled();
}

export interface SolanaClaimRow {
  id: number;
  creator: string;
  question: string;
  creator_position: string;
  counter_position: string;
  resolution_url: string;
  category: string;
  creator_stake: string; // base units (6dp), kept as text to avoid float drift
  total_challenger_stake: string;
  deadline: number; // unix seconds
  state: number;
  winner_side: number;
  resolution_summary: string;
  confidence: number;
  created_at: number;
  max_challengers: number;
  delegated: boolean;
  challengers: { addr: string; stake: string; paid: boolean; agent?: string }[];
  updated_at: number;
  // ── V3: optimistic resolution + frozen fee terms ──
  creator_paid: boolean;
  proposed_side: number;
  proposed_at: number;
  /** Unix seconds; a PROPOSED claim is disputable until then. */
  disputable_until: number;
  /** Base58, '' when never disputed. */
  disputer: string;
  disputed_at: number;
  bond: string; // base units
  bond_state: number;
  dispute_window: number;
  resolution_grace: number;
  resolved_at: number;
  creator_agent: string; // base58, '' = none
  platform_fee_bps: number;
  agent_fee_bps: number;
  total_fees: string; // base units
}

const V3_COLUMNS = [
  "creator_paid", "proposed_side", "proposed_at", "disputable_until", "disputer", "disputed_at",
  "bond", "bond_state", "dispute_window", "resolution_grace", "resolved_at", "creator_agent",
  "platform_fee_bps", "agent_fee_bps", "total_fees",
] as const;

const BIGINT_COLUMNS = [
  "deadline", "created_at", "updated_at", "proposed_at", "disputable_until", "disputed_at",
  "dispute_window", "resolution_grace", "resolved_at",
] as const;

/** Upsert one claim snapshot. Called by the indexer worker. */
export async function upsertClaim(row: SolanaClaimRow): Promise<void> {
  if (!isDbEnabled()) return;
  const p = await getDb();
  const v3 = V3_COLUMNS.map((c) => row[c]);
  const v3Params = V3_COLUMNS.map((_, i) => `$${21 + i}`).join(",");
  const v3Set = V3_COLUMNS.map((c, i) => `${c}=$${21 + i}`).join(", ");
  await p.query(
    `INSERT INTO solana_claims (
        id, creator, question, creator_position, counter_position,
        resolution_url, category, creator_stake, total_challenger_stake,
        deadline, state, winner_side, resolution_summary, confidence,
        created_at, max_challengers, delegated, challengers, updated_at, program,
        ${V3_COLUMNS.join(", ")}
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,${v3Params})
     ON CONFLICT (id) DO UPDATE SET
        creator=$2, question=$3, creator_position=$4, counter_position=$5,
        resolution_url=$6, category=$7, creator_stake=$8, total_challenger_stake=$9,
        deadline=$10, state=$11, winner_side=$12, resolution_summary=$13,
        confidence=$14, created_at=$15, max_challengers=$16, delegated=$17,
        challengers=$18, updated_at=$19, program=$20, ${v3Set}`,
    [
      row.id, row.creator, row.question, row.creator_position, row.counter_position,
      row.resolution_url, row.category, row.creator_stake, row.total_challenger_stake,
      row.deadline, row.state, row.winner_side, row.resolution_summary, row.confidence,
      row.created_at, row.max_challengers, row.delegated, JSON.stringify(row.challengers),
      row.updated_at, PROGRAM(), ...v3,
    ]
  );
}

export interface FeedFilters {
  states?: number[];
  category?: string;
  limit?: number;
}

/** Read the claim feed for /api/arena/claims. Newest first. */
export async function readClaims(filters: FeedFilters = {}): Promise<SolanaClaimRow[]> {
  if (!isDbEnabled()) return [];
  const p = await getDb();

  const params: any[] = [PROGRAM()];
  const where: string[] = ["program = $1"];
  if (filters.states?.length) {
    params.push(filters.states);
    where.push(`state = ANY($${params.length})`);
  }
  if (filters.category) {
    params.push(filters.category);
    where.push(`category = $${params.length}`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const limit = Math.min(filters.limit ?? 200, 500);

  const res = await p.query(
    `SELECT * FROM solana_claims ${whereSql} ORDER BY id DESC LIMIT ${limit}`,
    params
  );
  return res.rows.map(toRow);
}

function toRow(r: any): SolanaClaimRow {
  const out: any = {
    ...r,
    id: Number(r.id),
    challengers: typeof r.challengers === "string" ? JSON.parse(r.challengers) : r.challengers,
  };
  for (const c of BIGINT_COLUMNS) out[c] = Number(r[c] ?? 0);
  return out as SolanaClaimRow;
}

/** One claim by id, or null. Unlike the feed, never capped to the newest rows. */
export async function readClaim(id: number): Promise<SolanaClaimRow | null> {
  if (!isDbEnabled()) return null;
  const p = await getDb();
  const res = await p.query("SELECT * FROM solana_claims WHERE program = $1 AND id = $2", [PROGRAM(), id]);
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

export interface IndexStats {
  claimCount: number;
  totalResolved: number;
  openPool: string; // base units
}

export async function readStats(): Promise<IndexStats> {
  if (!isDbEnabled()) return { claimCount: 0, totalResolved: 0, openPool: "0" };
  const p = await getDb();
  const res = await p.query(
    `
    SELECT
      COUNT(*)::int AS claim_count,
      COUNT(*) FILTER (WHERE state = 2)::int AS total_resolved,
      COALESCE(SUM(
        CASE WHEN state IN (0,1,4,5)
          THEN creator_stake::numeric + total_challenger_stake::numeric
          ELSE 0 END
      ), 0)::text AS open_pool
    FROM solana_claims
    WHERE program = $1
  `,
    [PROGRAM()]
  );
  const row = res.rows[0];
  return {
    claimCount: Number(row.claim_count),
    totalResolved: Number(row.total_resolved),
    openPool: String(row.open_pool),
  };
}
