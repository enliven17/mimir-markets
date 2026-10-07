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
import type { TokenTier } from "../token-tiers";
import { councilRoster } from "./council-roster";
import { walletTier } from "./holder";
import { store, StoreConflict } from "./store";

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
  const [rows, bindings, agents] = await Promise.all([
    arcVolumeByUser(),
    store().list<{ solana: string; arc: string }>("arc_accounts", { limit: 5000 }),
    store().list<{ arc_operator: string | null; owner_wallet: string; status: string }>("agent_registry", { limit: 5000 }),
  ]);
  const operators = agents.filter((r) => r.arc_operator && r.status !== "revoked");
  const owner = new Map<string, string>([
    ...operators.map((r) => [String(r.arc_operator).toLowerCase(), r.owner_wallet] as const),
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
  type Count = { wallet: string; n: number };
  const countBy = <T,>(rows: T[], key: (r: T) => string): Count[] => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m].map(([wallet, n]) => ({ wallet, n }));
  };
  const s = store();
  const [volume, agentRows, basketRows, subRows, execRows, permRows, inviteRows] = await Promise.all([
    // Stakes from the Arc index, credited to the Solana wallet behind each Arc address. The Solana program's
    // volume went with its read index.
    onArc() ? arcVolume() : Promise.resolve([] as Array<{ wallet: string; usdc: string }>),
    s.list<{ owner_wallet: string; status: string }>("agent_registry", { limit: 5000 }),
    s.list<{ creator_wallet: string }>("baskets", { limit: 5000 }),
    s.list<{ follower: string }>("basket_subscriptions", { limit: 5000 }),
    s.list<{ permission_id: string; executed: boolean }>("copy_executions", { limit: 5000 }),
    s.list<{ id: string; follower: string }>("copy_permissions", { limit: 5000 }),
    s.list<{ wallet: string; referrer: string | null; created_at: number }>("campaign_invites", { limit: 5000 }),
  ]);
  const agents = countBy(agentRows.filter((r) => r.status === "active"), (r) => r.owner_wallet);
  const baskets = countBy(basketRows, (r) => r.creator_wallet);
  const follows = countBy(subRows, (r) => r.follower);
  const followerOf = new Map(permRows.map((p) => [p.id, p.follower]));
  const copies = countBy(
    execRows.filter((e) => e.executed && followerOf.has(e.permission_id)),
    (e) => followerOf.get(e.permission_id) as string,
  );
  const invites = inviteRows.sort((a, b) => a.created_at - b.created_at || (a.wallet < b.wallet ? -1 : 1));

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

type Invite = { wallet: string; code: string; referrer: string | null; created_at: number };

/** The wallet's invite code, or null when it has not joined. */
export async function inviteCodeOf(wallet: string): Promise<string | null> {
  return (await store().get<Invite>("campaign_invites", wallet))?.code ?? null;
}

/**
 * Join once: a fresh code for the wallet, and the referrer named by `inviteCode`
 * when it exists and is not the wallet itself. Joining again returns the same
 * code and never changes the referrer.
 */
export async function joinCampaign(wallet: string, inviteCode: string | null): Promise<{ code: string; referrer: string | null }> {
  const existing = await store().get<Invite>("campaign_invites", wallet);
  if (existing) return { code: existing.code, referrer: existing.referrer };

  const ref = inviteCode ? (await store().get<{ wallet: string }>("campaign_codes", inviteCode))?.wallet ?? null : null;
  const referrer = ref && ref !== wallet ? ref : null;

  for (let attempt = 0; attempt < 5; attempt++) {
    // 8 chars of A-Z0-9 from random bytes: ~41 bits, retried on the rare clash.
    const code = Array.from(randomBytes(8), (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 36]).join("");
    const now = Date.now();
    try {
      // The code and the wallet's row go in together, each only if new.
      await store().tx([
        { op: "insert", t: "campaign_codes", k: code, d: { code, wallet }, at: now, must: true },
        { op: "insert", t: "campaign_invites", k: wallet, d: { wallet, code, referrer, created_at: now }, i1: code, i2: referrer ?? undefined, at: now, must: true },
      ]);
      return { code, referrer };
    } catch (err) {
      if (!(err instanceof StoreConflict)) throw err;
      // Lost a race with this wallet's own other request: return what it wrote.
      const again = await store().get<Invite>("campaign_invites", wallet);
      if (again) return { code: again.code, referrer: again.referrer };
    }
  }
  throw new Error("could not allocate an invite code");
}
