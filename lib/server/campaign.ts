import "server-only";

/**
 * The testnet campaign leaderboard: per-wallet metrics read from tables the
 * app already writes, scored with lib/campaign.ts, plus invite codes.
 *
 * House wallets (council personas and CAMPAIGN_EXCLUDE_WALLETS, e.g. the
 * market creator) are left out, or they would top every column.
 */
import { ARC } from "@/lib/arc/config";
import { arcVolumeByUser } from "./arc-index";
import { randomBytes } from "node:crypto";

import {
  baseScore,
  EARLY_MULTIPLIER,
  EARLY_SLOTS,
  HOLDER_MULTIPLIER,
  INVITE_POINTS,
  INVITE_SHARE,
  INVITED_MULTIPLIER,
  type CampaignMetrics,
} from "../campaign";
import { MIMIR_PROGRAM_ID } from "../solana/config";
import type { TokenTier } from "../token-tiers";
import { councilRoster } from "./council-roster";
import { walletTier } from "./holder";
import { query } from "./db";

export interface CampaignRow extends CampaignMetrics {
  wallet: string;
  invites: number;
  invited: boolean;
  /** Among the first EARLY_SLOTS wallets to join. */
  early: boolean;
  /** $MIMIR holder tier from the current mainnet balance. */
  tier: TokenTier;
  score: number;
}

const EMPTY: CampaignMetrics = { volumeUsdc: 0, agents: 0, baskets: 0, follows: 0, copies: 0 };

/** The campaign restarts on Arc once its contracts are configured; points stay keyed by Solana address. */
function onArc(): boolean {
  return Boolean(ARC.contracts.mimirV3 && process.env.NEXT_PUBLIC_CONVEX_URL);
}

/**
 * Arc volume per Solana wallet: a passkey account counts for the wallet it is bound to, an agent's Arc operator for
 * the agent's owner. House addresses (council, market creator) map to nothing and never score.
 */
async function arcVolume(): Promise<Array<{ wallet: string; usdc: string }>> {
  const [rows, bindings, operators] = await Promise.all([
    arcVolumeByUser(),
    query<{ solana: string; arc: string }>("SELECT solana, arc FROM arc_accounts"),
    query<{ arc_operator: string; owner_wallet: string }>(
      "SELECT arc_operator, owner_wallet FROM agent_registry WHERE arc_operator IS NOT NULL AND status <> 'revoked'",
    ),
  ]);
  const owner = new Map<string, string>([
    ...operators.map((r) => [r.arc_operator.toLowerCase(), r.owner_wallet] as const),
    ...bindings.map((r) => [r.arc.toLowerCase(), r.solana] as const),
  ]);
  const totals = new Map<string, number>();
  for (const r of rows) {
    const wallet = owner.get(r.user);
    if (wallet) totals.set(wallet, (totals.get(wallet) ?? 0) + r.usdc);
  }
  return [...totals].map(([wallet, usdc]) => ({ wallet, usdc: String(usdc) }));
}

function excluded(): Set<string> {
  const env = (process.env.CAMPAIGN_EXCLUDE_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set([...env, ...councilRoster().map((p) => p.address).filter(Boolean)]);
}

/** Every scoring wallet, best first. ponytail: recomputed per request (cached 60s by the route); a nightly snapshot table if it gets slow. */
export async function campaignBoard(): Promise<CampaignRow[]> {
  const program = MIMIR_PROGRAM_ID.toBase58();
  const [volume, agents, baskets, follows, copies, invites] = await Promise.all([
    // On Arc: stakes from the index, credited to the Solana wallet behind each Arc address.
    onArc() ? arcVolume() :
    // An agent's operator stakes count for the agent's owner.
    query<{ wallet: string; usdc: string }>(
      `WITH stakes AS (
         SELECT creator AS wallet, creator_stake::numeric AS units FROM solana_claims WHERE program = $1
         UNION ALL
         SELECT ch->>'addr', (ch->>'stake')::numeric FROM solana_claims c, jsonb_array_elements(c.challengers) ch WHERE c.program = $1
       ), owners AS (
         SELECT DISTINCT ON (operator_wallet) operator_wallet, owner_wallet
           FROM agent_registry WHERE status <> 'revoked' ORDER BY operator_wallet, created_at
       )
       SELECT COALESCE(o.owner_wallet, s.wallet) AS wallet, SUM(s.units) / 1e6 AS usdc
         FROM stakes s LEFT JOIN owners o ON o.operator_wallet = s.wallet
        GROUP BY 1`,
      [program],
    ),
    query<{ wallet: string; n: string }>(`SELECT owner_wallet AS wallet, COUNT(*) AS n FROM agent_registry WHERE status = 'active' GROUP BY 1`),
    query<{ wallet: string; n: string }>(`SELECT creator_wallet AS wallet, COUNT(*) AS n FROM baskets GROUP BY 1`),
    query<{ wallet: string; n: string }>(`SELECT follower AS wallet, COUNT(*) AS n FROM basket_subscriptions GROUP BY 1`),
    query<{ wallet: string; n: string }>(
      `SELECT p.follower AS wallet, COUNT(*) AS n
         FROM copy_executions e JOIN copy_permissions p ON p.id = e.permission_id
        WHERE e.executed GROUP BY 1`,
    ),
    query<{ wallet: string; referrer: string | null }>(`SELECT wallet, referrer FROM campaign_invites ORDER BY created_at, wallet`),
  ]);

  const skip = excluded();
  const metrics = new Map<string, CampaignMetrics>();
  const add = (wallet: string, key: keyof CampaignMetrics, value: number) => {
    if (skip.has(wallet)) return;
    const m = metrics.get(wallet) ?? { ...EMPTY };
    metrics.set(wallet, { ...m, [key]: m[key] + value });
  };
  for (const r of volume) add(r.wallet, "volumeUsdc", Number(r.usdc));
  for (const r of agents) add(r.wallet, "agents", Number(r.n));
  for (const r of baskets) add(r.wallet, "baskets", Number(r.n));
  for (const r of follows) add(r.wallet, "follows", Number(r.n));
  for (const r of copies) add(r.wallet, "copies", Number(r.n));

  const referrerOf = new Map(invites.filter((r) => r.referrer).map((r) => [r.wallet, r.referrer as string]));
  // Join order decides the early slots; house wallets never take one.
  const early = new Set(invites.map((r) => r.wallet).filter((w) => !skip.has(w)).slice(0, EARLY_SLOTS));
  // ponytail: one mainnet balance read per scoring wallet per board refresh (60s edge cache); a cached tier column if the board grows past a few hundred.
  const tiers = new Map(
    await Promise.all(
      [...metrics.keys()].map(async (w) => [w, await walletTier(w).then((r) => r.tier).catch((): TokenTier => "none")] as const),
    ),
  );
  const own = new Map(
    [...metrics].map(([w, m]) => [
      w,
      baseScore(m) *
        (referrerOf.has(w) ? INVITED_MULTIPLIER : 1) *
        (early.has(w) ? EARLY_MULTIPLIER : 1) *
        HOLDER_MULTIPLIER[tiers.get(w) ?? "none"],
    ]),
  );

  // An invite counts once the invited wallet has points of its own.
  const inviteCount = new Map<string, number>();
  const inviteBonus = new Map<string, number>();
  for (const [invitee, referrer] of referrerOf) {
    const earned = own.get(invitee) ?? 0;
    if (earned <= 0 || skip.has(referrer)) continue;
    inviteCount.set(referrer, (inviteCount.get(referrer) ?? 0) + 1);
    inviteBonus.set(referrer, (inviteBonus.get(referrer) ?? 0) + INVITE_POINTS + earned * INVITE_SHARE);
  }

  const wallets = new Set([...own.keys(), ...inviteBonus.keys()]);
  return [...wallets]
    .map((wallet) => ({
      wallet,
      ...(metrics.get(wallet) ?? EMPTY),
      invites: inviteCount.get(wallet) ?? 0,
      invited: referrerOf.has(wallet),
      early: early.has(wallet),
      tier: tiers.get(wallet) ?? "none",
      score: Math.round((own.get(wallet) ?? 0) + (inviteBonus.get(wallet) ?? 0)),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** The wallet's invite code, or null when it has not joined. */
export async function inviteCodeOf(wallet: string): Promise<string | null> {
  const rows = await query<{ code: string }>("SELECT code FROM campaign_invites WHERE wallet = $1", [wallet]);
  return rows[0]?.code ?? null;
}

/**
 * Join once: a fresh code for the wallet, and the referrer named by `inviteCode`
 * when it exists and is not the wallet itself. Joining again returns the same
 * code and never changes the referrer.
 */
export async function joinCampaign(wallet: string, inviteCode: string | null): Promise<{ code: string; referrer: string | null }> {
  const existing = await query<{ code: string; referrer: string | null }>(
    "SELECT code, referrer FROM campaign_invites WHERE wallet = $1",
    [wallet],
  );
  if (existing[0]) return existing[0];

  const ref = inviteCode
    ? (await query<{ wallet: string }>("SELECT wallet FROM campaign_invites WHERE code = $1", [inviteCode]))[0]?.wallet ?? null
    : null;
  const referrer = ref && ref !== wallet ? ref : null;

  for (let attempt = 0; attempt < 5; attempt++) {
    // 8 chars of A-Z0-9 from random bytes: ~41 bits, retried on the rare clash.
    const code = Array.from(randomBytes(8), (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 36]).join("");
    const rows = await query<{ code: string; referrer: string | null }>(
      `INSERT INTO campaign_invites (wallet, code, referrer, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING code, referrer`,
      [wallet, code, referrer, Date.now()],
    );
    if (rows[0]) return rows[0];
    // Lost a race with this wallet's own other request: return what it wrote.
    const again = await query<{ code: string; referrer: string | null }>(
      "SELECT code, referrer FROM campaign_invites WHERE wallet = $1",
      [wallet],
    );
    if (again[0]) return again[0];
  }
  throw new Error("could not allocate an invite code");
}
