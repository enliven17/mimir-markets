// The council's memory on Arc: every persona decision (stake, abstain, retry) per market, for the reasoning shown on
// market pages and so a considered "no" is not re-asked of the LLM until it expires.
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

const kind = v.union(v.literal("vs"), v.literal("pool"));

/** Decisions still standing (until > now), as "slug:kind:id" keys. */
export const standing = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db.query("arcCouncilDecisions").withIndex("by_until", (q) => q.gt("until", now)).collect();
    return rows.map((r) => `${r.slug}:${r.kind}:${r.marketId}`);
  },
});

export const record = internalMutation({
  args: {
    slug: v.string(),
    kind,
    marketId: v.number(),
    outcome: v.union(v.literal("staked"), v.literal("abstained"), v.literal("retry"), v.literal("failed")),
    rationale: v.string(),
    confidence: v.optional(v.number()),
    amount: v.optional(v.string()),
    txHash: v.optional(v.string()),
    until: v.number(),
  },
  handler: async (ctx, d) => {
    const prev = await ctx.db
      .query("arcCouncilDecisions")
      .withIndex("by_persona_market", (q) => q.eq("slug", d.slug).eq("kind", d.kind).eq("marketId", d.marketId))
      .unique();
    if (prev) await ctx.db.replace(prev._id, { ...d, at: Date.now() });
    else await ctx.db.insert("arcCouncilDecisions", { ...d, at: Date.now() });
  },
});

/** What the council thought about one market: shown on its page. */
export const forMarket = query({
  args: { kind, marketId: v.number() },
  handler: async (ctx, { kind, marketId }) =>
    (await ctx.db.query("arcCouncilDecisions").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).collect())
      .filter((d) => d.outcome === "staked" || d.outcome === "abstained")
      .map(({ slug, outcome, rationale, confidence, amount, txHash, at }) => ({ slug, outcome, rationale, confidence, amount, txHash, at })),
});
