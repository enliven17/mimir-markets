/**
 * House baskets: mixes of the council personas that ship with every deploy.
 *
 * They need no database and no composer signature, so the directory is never
 * empty and anyone can follow a council mix from day one. They behave like any
 * other basket (replayed curve, open signals, follow and mirror); only the
 * composer is "the council" instead of a wallet. Ids are reserved: nobody can
 * compose a basket under one of them.
 */
import { validateBasket, type BasketMember } from "@/lib/baskets";
import { followerCounts, getBasket, listBaskets, type BasketRow } from "@/lib/baskets-store";
import { storeEnabled } from "@/lib/server/store";

/** Fixed so the ordering and "composed" dates never move between deploys. */
const HOUSE_CREATED_AT = Date.UTC(2026, 8, 1);

const even = (slugs: string[]): BasketMember[] =>
  slugs.map((agentId) => ({ agentId, weightBps: 10_000 / slugs.length }));

const DEFINITIONS: Array<Pick<BasketRow, "id" | "name" | "thesis" | "members">> = [
  {
    id: "council-classic",
    name: "Classic jury",
    thesis:
      "All ten classic personas at equal weight: the optimist and the pessimist, the rule followers and the specialists. No single temperament steers the mix.",
    members: even([
      "optimist",
      "pessimist",
      "contrarian",
      "statistician",
      "whale-watcher",
      "crypto-maxi",
      "sports-pundit",
      "weatherman",
      "doomer",
      "yapper",
    ]),
  },
  {
    id: "council-philosophers",
    name: "Philosopher jury",
    thesis:
      "The ten philosopher personas at equal weight. Slow, sceptical readers of the evidence who rarely chase a crowded side.",
    members: even([
      "socrates",
      "kahneman",
      "taleb",
      "feynman",
      "munger",
      "ada",
      "meadows",
      "machiavelli",
      "aurelius",
      "lao-tzu",
    ]),
  },
  {
    id: "fade-the-crowd",
    name: "Fade the crowd",
    thesis:
      "Take the side the pool is short. The contrarian leads, with Taleb and the pessimist for the tails a crowded market ignores.",
    members: [
      { agentId: "contrarian", weightBps: 4_000 },
      { agentId: "taleb", weightBps: 3_000 },
      { agentId: "pessimist", weightBps: 3_000 },
    ],
  },
  {
    id: "rules-only",
    name: "Rules, no model",
    thesis:
      "The two personas that never call a language model: pool-imbalance maths and following the largest staker. Every position can be predicted from the chain alone.",
    members: [
      { agentId: "contrarian", weightBps: 5_000 },
      { agentId: "whale-watcher", weightBps: 5_000 },
    ],
  },
  {
    id: "numbers-first",
    name: "Numbers first",
    thesis:
      "Stake only when the data is overwhelming. The statistician leads, Kahneman and Feynman check it for bias and hand-waving.",
    members: [
      { agentId: "statistician", weightBps: 4_000 },
      { agentId: "kahneman", weightBps: 3_000 },
      { agentId: "feynman", weightBps: 3_000 },
    ],
  },
];

export const HOUSE_BASKETS: BasketRow[] = DEFINITIONS.map((d) => {
  // Held to the same policy as a composed basket; a bad edit fails at import.
  validateBasket(d);
  return { ...d, creatorWallet: "", createdAt: HOUSE_CREATED_AT, followers: 0, house: true };
});

const byId = new Map(HOUSE_BASKETS.map((b) => [b.id, b]));

export function houseBasket(id: string): BasketRow | null {
  return byId.get(id) ?? null;
}

export function isHouseBasketId(id: string): boolean {
  return byId.has(id);
}

/** House baskets with their follower counts when a database is there to count them. */
async function withFollowers(rows: BasketRow[]): Promise<BasketRow[]> {
  if (!storeEnabled()) return rows;
  const counts = await followerCounts(rows.map((b) => b.id)).catch(() => new Map<string, number>());
  return rows.map((b) => ({ ...b, followers: counts.get(b.id) ?? 0 }));
}

/** The directory: composed baskets ranked by followers, then the house baskets. */
export async function basketDirectory(): Promise<BasketRow[]> {
  const [stored, house] = await Promise.all([
    storeEnabled() ? listBaskets().catch(() => [] as BasketRow[]) : Promise.resolve([] as BasketRow[]),
    withFollowers(HOUSE_BASKETS),
  ]);
  return [...stored.filter((b) => !isHouseBasketId(b.id)), ...house];
}

/** One basket by id: a house basket first (reserved ids), else the stored one. */
export async function findBasket(id: string): Promise<BasketRow | null> {
  const house = houseBasket(id);
  if (house) return (await withFollowers([house]))[0];
  return getBasket(id).catch(() => null);
}
