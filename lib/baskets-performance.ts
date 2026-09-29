import "server-only";

/**
 * Turning the read index into a basket curve and mirror signals.
 *
 * A basket member is named by id (a council persona slug or a registered agent
 * id); the chain only knows wallets. This resolves ids to the wallets that
 * actually stake (a persona's derived key, an agent's operator wallet), reads
 * the claims those wallets challenged from `solana_claims`, and hands the pure
 * functions in lib/baskets.ts realized outcomes. Nothing here invents a
 * return: an agent that never settled anything contributes nothing.
 */
import { query } from "@/lib/server/db";
import { councilRoster } from "@/lib/server/council-roster";
import { MIMIR_PROGRAM_ID, ST_ACTIVE, ST_OPEN, ST_RESOLVED } from "@/lib/solana/config";
import {
  mirrorSignals,
  settlementsFromClaims,
  type BasketMember,
  type IndexedClaim,
  type MemberSettlement,
  type MirrorSignal,
} from "@/lib/baskets";

/**
 * Map member ids to staking wallets. Personas resolve from the roster (derived
 * from the admin key), registered agents from the registry's operator wallet.
 * An id that resolves to neither is dropped rather than guessed at.
 */
export async function resolveAgentWallets(agentIds: string[]): Promise<Map<string, string>> {
  const wanted = new Set(agentIds);
  const map = new Map<string, string>();

  for (const p of councilRoster()) {
    if (wanted.has(p.slug) && p.address) map.set(p.slug, p.address);
  }

  const missing = agentIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    const rows = await query(
      "SELECT agent_id, operator_wallet FROM agent_registry WHERE agent_id = ANY($1) AND status <> 'revoked'",
      [missing],
    ).catch(() => []);
    for (const r of rows) map.set(String(r.agent_id), String(r.operator_wallet));
  }
  return map;
}

function invert(wallets: Map<string, string>): Map<string, string> {
  const byWallet = new Map<string, string>();
  for (const [agentId, wallet] of wallets) byWallet.set(wallet, agentId);
  return byWallet;
}

/** Claims of this program where any of `wallets` is a challenger, in `states`. Shared with copy trading. */
export async function claimsChallengedBy(wallets: string[], states: number[], limit: number): Promise<IndexedClaim[]> {
  if (wallets.length === 0) return [];
  const rows = await query(
    `SELECT id, creator, state, winner_side, creator_stake, total_challenger_stake, deadline,
            resolved_at, max_challengers, delegated, platform_fee_bps, agent_fee_bps, challengers,
            question, category, creator_position, counter_position, resolution_url, created_at
       FROM solana_claims c
      WHERE c.program = $1
        AND c.state = ANY($2)
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(c.challengers) ch WHERE ch->>'addr' = ANY($3)
        )
      ORDER BY c.id DESC
      LIMIT $4`,
    [MIMIR_PROGRAM_ID.toBase58(), states, wallets, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    creator: String(r.creator ?? ""),
    state: Number(r.state),
    winner_side: Number(r.winner_side ?? 0),
    creator_stake: String(r.creator_stake ?? "0"),
    total_challenger_stake: String(r.total_challenger_stake ?? "0"),
    deadline: Number(r.deadline ?? 0),
    resolved_at: Number(r.resolved_at ?? 0),
    max_challengers: Number(r.max_challengers ?? 0),
    delegated: Boolean(r.delegated),
    platform_fee_bps: Number(r.platform_fee_bps ?? 0),
    agent_fee_bps: Number(r.agent_fee_bps ?? 0),
    challengers: (typeof r.challengers === "string" ? JSON.parse(r.challengers) : r.challengers) ?? [],
    question: String(r.question ?? ""),
    category: String(r.category ?? ""),
    creator_position: String(r.creator_position ?? ""),
    counter_position: String(r.counter_position ?? ""),
    resolution_url: String(r.resolution_url ?? ""),
    created_at: Number(r.created_at ?? 0),
  }));
}

/** Realized, after-fee outcomes for a basket's members (RESOLVED claims only). */
export async function loadMemberSettlements(
  members: BasketMember[],
  wallets?: Map<string, string>,
): Promise<MemberSettlement[]> {
  const resolved = wallets ?? (await resolveAgentWallets(members.map((m) => m.agentId)));
  const byWallet = invert(resolved);
  const claims = await claimsChallengedBy([...byWallet.keys()], [ST_RESOLVED], 1_000);
  return settlementsFromClaims(claims, byWallet);
}

/** Live positions of a basket's members that `follower` could copy now. */
export async function loadMirrorSignals(args: {
  members: BasketMember[];
  follower: string | null;
  perMarketCapUsdc: number;
  wallets?: Map<string, string>;
}): Promise<MirrorSignal[]> {
  const resolved = args.wallets ?? (await resolveAgentWallets(args.members.map((m) => m.agentId)));
  const byWallet = invert(resolved);
  const claims = await claimsChallengedBy([...byWallet.keys()], [ST_OPEN, ST_ACTIVE], 200);
  return mirrorSignals({
    claims,
    agentByWallet: byWallet,
    follower: args.follower,
    perMarketCapUsdc: args.perMarketCapUsdc,
  });
}
