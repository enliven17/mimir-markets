// Jev's triage of new Arc markets (lib/jev-triage.ts): written by the indexer (convex/arcSync.ts) when a market
// appears, read by the council before it spends a model call on a take. No rows while TYPESAFE_API_KEY is unset.
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

const kind = v.union(v.literal("vs"), v.literal("pool"));

export const save = internalMutation({
  args: { kind, marketId: v.number(), resolvable: v.number(), spam: v.number(), category: v.string(), categoryConfidence: v.number() },
  handler: async (ctx, t) => {
    const prev = await ctx.db.query("arcTriage").withIndex("by_market", (q) => q.eq("kind", t.kind).eq("marketId", t.marketId)).first();
    if (!prev) await ctx.db.insert("arcTriage", { ...t, at: Date.now() });
  },
});

/** Every triage, keyed "kind:id" (one row per market). */
export const all = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("arcTriage").collect()).map(({ kind, marketId, resolvable, spam, category, categoryConfidence }) => ({ key: `${kind}:${marketId}`, resolvable, spam, category, categoryConfidence })),
});

/** One market's triage, or null (Jev off, or not triaged yet). */
export const of = query({
  args: { kind, marketId: v.number() },
  handler: async (ctx, { kind, marketId }) => (await ctx.db.query("arcTriage").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).first()) ?? null,
});
