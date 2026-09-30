/**
 * Persistence for baskets and their followers (Postgres, lib/server/db.ts).
 *
 * A subscription is a signed intent, not a deposit: the row records the cap a
 * follower approved and the ed25519 signature that approved it. Setting the
 * cap to zero is how you unfollow, so a revocation is the same shape as a
 * grant and can be audited the same way. Wallets are base58 and stored exactly
 * as given (base58 is case-sensitive).
 *
 * No "server-only" guard, matching lib/agents/store.ts. Without DATABASE_URL
 * every call throws; routes catch and degrade.
 */
import { query } from "@/lib/server/db";
import { validateBasket, type BasketDefinition, type BasketMember } from "@/lib/baskets";

export interface BasketRow extends BasketDefinition {
  followers: number;
  /** A council mix that ships with the app (lib/house-baskets.ts), not a stored one. */
  house?: boolean;
}

function parseMembers(raw: unknown): BasketMember[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]")) as BasketMember[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toRow(r: Record<string, unknown>): BasketRow {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    thesis: String(r.thesis ?? ""),
    creatorWallet: String(r.creator_wallet ?? ""),
    members: parseMembers(r.members_json),
    createdAt: Number(r.created_at ?? 0),
    followers: Number(r.followers ?? 0),
  };
}

const WITH_FOLLOWERS = `
  SELECT b.id, b.name, b.thesis, b.creator_wallet, b.members_json, b.created_at,
         COALESCE(f.n, 0) AS followers
    FROM baskets b
    LEFT JOIN (
      SELECT basket_id, COUNT(*) AS n
        FROM basket_subscriptions
       WHERE per_market_cap_usdc > 0
       GROUP BY basket_id
    ) f ON f.basket_id = b.id
`;

export async function listBaskets(limit = 100): Promise<BasketRow[]> {
  const rows = await query(`${WITH_FOLLOWERS} ORDER BY followers DESC, b.created_at DESC LIMIT $1`, [limit]);
  return rows.map(toRow);
}

export async function getBasket(id: string): Promise<BasketRow | null> {
  const rows = await query(`${WITH_FOLLOWERS} WHERE b.id = $1`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Active follower counts for baskets that have no stored row (the house baskets). */
export async function followerCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await query(
    `SELECT basket_id, COUNT(*) AS n FROM basket_subscriptions
      WHERE per_market_cap_usdc > 0 AND basket_id = ANY($1) GROUP BY basket_id`,
    [ids],
  );
  return new Map(rows.map((r) => [String(r.basket_id), Number(r.n ?? 0)]));
}

export class BasketExistsError extends Error {
  constructor() {
    super("basket_exists");
  }
}

export async function createBasket(input: {
  id: string;
  name: string;
  thesis: string;
  creatorWallet: string;
  members: BasketMember[];
  signature: string;
}, now = Date.now()): Promise<BasketRow> {
  // Validated again here, not only at the route: a basket that reaches storage
  // invalid would produce a curve nobody can reproduce.
  validateBasket(input);

  // The primary key settles a race between two composers picking the same id.
  const inserted = await query(
    `INSERT INTO baskets (id, name, thesis, creator_wallet, members_json, signature, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      input.id,
      input.name.trim(),
      input.thesis.trim(),
      input.creatorWallet,
      JSON.stringify(input.members.map((m) => ({ agentId: m.agentId, weightBps: m.weightBps }))),
      input.signature,
      now,
    ],
  );
  if (inserted.length === 0) throw new BasketExistsError();
  const created = await getBasket(input.id);
  if (!created) throw new Error("basket insert did not persist");
  return created;
}

export interface Subscription {
  perMarketCapUsdc: number;
  /** The signedAt of the signature on file (ms). */
  updatedAt: number;
}

/**
 * Follow, change the cap, or unfollow (cap 0). One row per follower per
 * basket. The conditional upsert only lands when this signature is newer than
 * the one on file, so a replayed or reordered signature is a no-op; returns
 * false in that case.
 */
export async function setSubscription(args: {
  basketId: string;
  follower: string;
  perMarketCapUsdc: number;
  signature: string;
  signedAt: number;
}): Promise<boolean> {
  const rows = await query(
    `INSERT INTO basket_subscriptions (basket_id, follower, per_market_cap_usdc, signature, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (basket_id, follower)
     DO UPDATE SET per_market_cap_usdc = EXCLUDED.per_market_cap_usdc,
                   signature = EXCLUDED.signature,
                   updated_at = EXCLUDED.updated_at
     WHERE basket_subscriptions.updated_at < EXCLUDED.updated_at
     RETURNING basket_id`,
    [args.basketId, args.follower, args.perMarketCapUsdc, args.signature, args.signedAt],
  );
  return rows.length > 0;
}

export async function getSubscription(basketId: string, follower: string): Promise<Subscription | null> {
  const rows = await query(
    "SELECT per_market_cap_usdc, updated_at FROM basket_subscriptions WHERE basket_id = $1 AND follower = $2",
    [basketId, follower],
  );
  if (!rows[0]) return null;
  return {
    perMarketCapUsdc: Number(rows[0].per_market_cap_usdc ?? 0),
    updatedAt: Number(rows[0].updated_at ?? 0),
  };
}
