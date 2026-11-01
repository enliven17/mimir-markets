import { assertMarketDeployment } from "./marketDeploymentGuard";
// Jev's triage of new Arc markets (lib/jev-triage.ts): written by the indexer (convex/arcSync.ts) when a market
// appears, read by the council before it spends a model call on a take. No rows while TYPESAFE_API_KEY is unset.
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { vChain } from "./schema";

const kind = v.union(v.literal("vs"), v.literal("pool"));

export const save = internalMutation({
  args: { chain: vChain, kind, marketId: v.number(), resolvable: v.number(), spam: v.number(), category: v.string(), categoryConfidence: v.number() },
  handler: async (ctx, t) => {
    await assertMarketDeployment(ctx);
    const prev = await ctx.db.query("arcTriage").withIndex("by_market", (q) => q.eq("chain", t.chain).eq("kind", t.kind).eq("marketId", t.marketId)).first();
    if (!prev) await ctx.db.insert("arcTriage", { ...t, at: Date.now() });
  },
});

/** Every triage, keyed "chain:kind:id" (one row per market). */
export const all = internalQuery({
  args: {},
  handler: async (ctx) =>
    {
    await assertMarketDeployment(ctx);
    return (await ctx.db.query("arcTriage").order("desc").take(5000)).map(({ chain, kind, marketId, resolvable, spam, category, categoryConfidence }) => ({
      key: `${chain ?? "arc"}:${kind}:${marketId}`, resolvable, spam, category, categoryConfidence,
    }));
  },
});

/** One market's triage, or null (Jev off, or not triaged yet). */
export const of = query({
  args: { chain: v.optional(vChain), kind, marketId: v.number() },
  handler: async (ctx, { chain = "arc", kind, marketId }) =>
    {
    await assertMarketDeployment(ctx);
    return (await ctx.db.query("arcTriage").withIndex("by_market", (q) => q.eq("chain", chain).eq("kind", kind).eq("marketId", marketId)).first()) ?? null;
  },
});
