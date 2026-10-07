/**
 * Persistence for baskets and their followers (the backend, lib/server/store.ts: tables `baskets`, key id, i1 the
 * creator; `basket_subscriptions`, key basket:follower, i1 the basket, i2 the follower).
 *
 * A subscription is a signed intent, not a deposit: the row records the cap a
 * follower approved and the ed25519 signature that approved it. Setting the
 * cap to zero is how you unfollow, so a revocation is the same shape as a
 * grant and can be audited the same way. Wallets are base58 and stored exactly
 * as given (base58 is case-sensitive).
 *
 * No "server-only" guard, matching lib/agents/store.ts. Without the backend
 * every call throws; routes catch and degrade.
 */
import { insert, store, update } from "@/lib/server/store";
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

type SubRow = { basket_id: string; follower: string; per_market_cap_usdc: number; signature: string; updated_at: number };

async function activeFollowers(): Promise<Map<string, number>> {
  const subs = await store().list<SubRow>("basket_subscriptions", { limit: 5000 });
  const n = new Map<string, number>();
  for (const s of subs) if (Number(s.per_market_cap_usdc) > 0) n.set(s.basket_id, (n.get(s.basket_id) ?? 0) + 1);
  return n;
}

export async function listBaskets(limit = 100): Promise<BasketRow[]> {
  const [rows, followers] = await Promise.all([store().list<Record<string, unknown>>("baskets", { limit: 5000 }), activeFollowers()]);
  return rows
    .map((r) => toRow({ ...r, followers: followers.get(String(r.id)) ?? 0 }))
    .sort((a, b) => b.followers - a.followers || b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function getBasket(id: string): Promise<BasketRow | null> {
  const r = await store().get<Record<string, unknown>>("baskets", id);
  if (!r) return null;
  const subs = await store().list<SubRow>("basket_subscriptions", { i1: id, limit: 5000 });
  return toRow({ ...r, followers: subs.filter((s) => Number(s.per_market_cap_usdc) > 0).length });
}

/** Active follower counts for baskets that have no stored row (the house baskets). */
export async function followerCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const all = await activeFollowers();
  return new Map(ids.map((id) => [id, all.get(id) ?? 0]));
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

  // The first insert of the id wins a race between two composers picking the same one.
  const inserted = await insert(
    "baskets",
    input.id,
    {
      id: input.id,
      name: input.name.trim(),
      thesis: input.thesis.trim(),
      creator_wallet: input.creatorWallet,
      members_json: JSON.stringify(input.members.map((m) => ({ agentId: m.agentId, weightBps: m.weightBps }))),
      signature: input.signature,
      created_at: now,
    },
    { i1: input.creatorWallet, at: now },
  );
  if (!inserted) throw new BasketExistsError();
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
 * basket. The write only lands when this signature is newer than
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
  const k = `${args.basketId}:${args.follower}`;
  const row: SubRow = {
    basket_id: args.basketId,
    follower: args.follower,
    per_market_cap_usdc: args.perMarketCapUsdc,
    signature: args.signature,
    updated_at: args.signedAt,
  };
  const idx = { i1: args.basketId, i2: args.follower, at: args.signedAt };
  const prev = await store().get<SubRow>("basket_subscriptions", k);
  if (!prev) return insert("basket_subscriptions", k, row, idx);
  if (prev.updated_at >= args.signedAt) return false;
  // Compare-and-set on the signature time on file: a newer signature that landed in between wins.
  return update("basket_subscriptions", k, row, { updated_at: prev.updated_at }, idx);
}

export async function getSubscription(basketId: string, follower: string): Promise<Subscription | null> {
  const row = await store().get<SubRow>("basket_subscriptions", `${basketId}:${follower}`);
  if (!row) return null;
  return { perMarketCapUsdc: Number(row.per_market_cap_usdc ?? 0), updatedAt: Number(row.updated_at ?? 0) };
}
