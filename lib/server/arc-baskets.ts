import "server-only";

/**
 * Baskets and copy trading on Arc: the same pure functions as on Solana
 * (lib/baskets.ts, lib/copy-signals.ts) fed from the Convex index instead of
 * `solana_claims`. Members resolve to the addresses that stake on Arc: a
 * persona's Circle wallet, an agent's Arc operator. Addresses are lowercase.
 */
import type { IndexedClaim } from "@/lib/baskets";
import { query } from "./db";
import { arcChallengedBy, arcCouncilWallets } from "./arc-index";

// Same numbering as MimirV3 and the Solana program: 0 open, 1 active, 2 resolved, 3 cancelled, 4 proposed, 5 disputed.
const STATUS_OF: Record<number, string> = { 0: "open", 1: "active", 2: "resolved", 3: "cancelled", 4: "proposed", 5: "disputed" };
const STATE_OF: Record<string, number> = { open: 0, active: 1, resolved: 2, cancelled: 3, proposed: 4, disputed: 5 };
const units = (wei: string) => (BigInt(wei) / 1_000_000_000_000n).toString();

export async function resolveArcAgentWallets(agentIds: string[]): Promise<Map<string, string>> {
  const wanted = new Set(agentIds);
  const map = new Map<string, string>();
  for (const [slug, address] of await arcCouncilWallets().catch(() => new Map<string, string>())) {
    if (wanted.has(slug)) map.set(slug, address);
  }
  const missing = agentIds.filter((id) => !map.has(id));
  if (missing.length) {
    const rows = await query(
      "SELECT agent_id, arc_operator FROM agent_registry WHERE agent_id = ANY($1) AND status <> 'revoked' AND arc_operator IS NOT NULL",
      [missing],
    ).catch(() => []);
    for (const r of rows) map.set(String(r.agent_id), String(r.arc_operator).toLowerCase());
  }
  return map;
}

export async function arcClaimsChallengedBy(wallets: string[], states: number[], limit: number): Promise<IndexedClaim[]> {
  if (!wallets.length) return [];
  const markets = await arcChallengedBy(wallets, states.map((s) => STATUS_OF[s]).filter(Boolean), limit);
  return markets.map((m) => ({
    id: m.marketId,
    creator: m.creator,
    state: STATE_OF[m.status] ?? 0,
    winner_side: m.winner,
    creator_stake: units(m.stakeA),
    total_challenger_stake: units(m.stakeB),
    deadline: m.deadline,
    resolved_at: m.status === "resolved" ? m.deadline : 0,
    max_challengers: 100,
    delegated: false,
    // No fee on winnings on Arc (entry fees are already out of the stakes); copies add theirs at payout.
    platform_fee_bps: 0,
    agent_fee_bps: 0,
    challengers: m.positions.filter((p) => p.side === 2).map((p) => ({ addr: p.user, stake: units(p.amount) })),
    question: m.question,
    category: m.category,
    creator_position: m.labelA,
    counter_position: m.labelB,
    resolution_url: m.resolutionUrl,
    created_at: m.createdAt,
  }));
}
