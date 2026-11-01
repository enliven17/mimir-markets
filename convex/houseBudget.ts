import { assertMarketDeployment } from "./marketDeploymentGuard";
// The house creator's daily budget, ONE budget for every chain (CREATOR_DAILY_BUDGET_USDC, default 1 USDC a day):
// what the house stakes on the markets it opens today (UTC), its own drafts (convex/arcCreator.ts) and the twins it
// opens for other people's pools (convex/arcTwins.ts) alike. Each open reserves its seed here first, atomically, and a
// send that fails releases it, so two jobs running at once never overspend.
// Spent today = the larger of this ledger and the house's indexed positions on markets it opened today (the ledger is
// new: before it existed, only the index knew).
import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { vChain } from "./schema";
import { houseCreatorWallet } from "../lib/chains/house";
import { usdToIndex } from "../lib/chains/amounts";
import { budgetDay, fitsBudget } from "../lib/chains/twins";

const envNum = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) ? n : fallback;
};

/** Today's budget, index units. */
export const budgetWei = (): bigint => usdToIndex(envNum("CREATOR_DAILY_BUDGET_USDC", 1));

async function spentWei(ctx: QueryCtx, day: string): Promise<bigint> {
  const ledger = (await ctx.db.query("houseSpend").withIndex("by_day", (q) => q.eq("day", day)).take(2000)).reduce((s, r) => s + BigInt(r.wei), 0n);
  const dayStart = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  let indexed = 0n;
  for (const chain of ["base", "arc"] as const) {
    const house = houseCreatorWallet(chain)?.address;
    if (!house) continue;
    const legs = await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", house)).order("desc").take(300);
    for (const p of legs) {
      if ((p.chain ?? "arc") !== chain) continue;
      const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("chain", chain).eq("kind", p.kind).eq("marketId", p.marketId)).unique();
      if (m && m.creator === house && m.createdAt >= dayStart && m.status !== "cancelled") indexed += BigInt(p.amount);
    }
  }
  return ledger > indexed ? ledger : indexed;
}

/** What is left of today's shared budget, index units (a string: Convex has no bigint over the wire here). */
export const left = internalQuery({
  args: {},
  handler: async (ctx) => {
    await assertMarketDeployment(ctx);
    const left = budgetWei() - (await spentWei(ctx, budgetDay(Date.now())));
    return (left > 0n ? left : 0n).toString();
  },
});

/** Reserve `wei` of today's budget for one open; null when it does not fit. */
export const reserve = internalMutation({
  args: { chain: vChain, wei: v.string(), ref: v.string() },
  handler: async (ctx, { chain, wei, ref }) => {
    await assertMarketDeployment(ctx);
    const day = budgetDay(Date.now());
    if (!fitsBudget(budgetWei(), await spentWei(ctx, day), BigInt(wei))) return null;
    return await ctx.db.insert("houseSpend", { day, chain, wei, ref, at: Date.now() });
  },
});

/** Give a reservation back (the open failed before anything was sent). */
export const release = internalMutation({
  args: { id: v.id("houseSpend") },
  handler: async (ctx, { id }) => {
    await assertMarketDeployment(ctx);
    if (await ctx.db.get(id)) await ctx.db.delete(id);
  },
});
