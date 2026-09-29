/**
 * Every claim one wallet holds a position in (as creator or challenger), for
 * the dashboard. Served from the read index when DATABASE_URL is set; without
 * it, from one cached chain scan shared by every wallet.
 */
import { Keypair } from "@solana/web3.js";

import { isDbEnabled, query } from "./db";
import { claimToApi, rowToApi, type ApiClaim } from "./arena-claim";
import type { SolanaClaimRow } from "./solana-index";
import { cachedFor } from "./ttl-cache";
import { MimirSolanaClient } from "../solana/client";
import { MIMIR_PROGRAM_ID } from "../solana/config";

const BIGINT_COLUMNS = [
  "deadline", "created_at", "updated_at", "proposed_at", "disputable_until", "disputed_at",
  "dispute_window", "resolution_grace", "resolved_at",
] as const;

export interface UserClaims {
  claims: ApiClaim[];
  source: "index" | "chain";
  /** Unix seconds of the freshest index write among them (0 for chain reads). */
  indexedAt: number;
}

function toRow(r: Record<string, unknown>): SolanaClaimRow {
  const out: Record<string, unknown> = {
    ...r,
    id: Number(r.id),
    challengers: typeof r.challengers === "string" ? JSON.parse(r.challengers) : r.challengers,
  };
  for (const c of BIGINT_COLUMNS) out[c] = Number(r[c] ?? 0);
  return out as unknown as SolanaClaimRow;
}

async function fromIndex(address: string): Promise<UserClaims> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM solana_claims
      WHERE program = $1 AND (creator = $2 OR challengers @> $3::jsonb)
      ORDER BY id DESC LIMIT 500`,
    [MIMIR_PROGRAM_ID.toBase58(), address, JSON.stringify([{ addr: address }])],
  );
  const parsed = rows.map(toRow);
  return {
    claims: parsed.map(rowToApi),
    source: "index",
    indexedAt: parsed.reduce((max, r) => Math.max(max, r.updated_at || 0), 0),
  };
}

let reader: MimirSolanaClient | null = null;

/** Every claim from chain, newest first; one scan per instance per TTL. */
const scanChain = cachedFor(async (): Promise<ApiClaim[]> => {
  reader ??= new MimirSolanaClient(Keypair.generate());
  const cfg = await reader.getConfig();
  if (!cfg) return [];
  const ids: bigint[] = [];
  for (let id = 1n; id <= cfg.claimCount; id++) ids.push(id);
  const delegated = await reader.isDelegatedBatch(ids);
  const out: ApiClaim[] = [];
  for (const id of ids) {
    const inEr = delegated.get(id) ?? false;
    const claim = inEr ? await reader.getClaim(id) : await reader.getBaseClaim(id).catch(() => null);
    if (claim) out.push(claimToApi(claim, inEr));
  }
  return out.reverse();
}, 15_000);

export const isParticipant = (c: Pick<ApiClaim, "creator" | "challengers">, address: string): boolean =>
  c.creator === address || c.challengers.some((ch) => ch.addr === address);

export async function readUserClaims(address: string): Promise<UserClaims> {
  if (isDbEnabled()) return fromIndex(address);
  const all = await scanChain();
  return { claims: all.filter((c) => isParticipant(c, address)), source: "chain", indexedAt: 0 };
}
