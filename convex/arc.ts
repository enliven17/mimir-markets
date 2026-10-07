import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import schema, { status } from "./schema";

const kind = v.union(v.literal("vs"), v.literal("pool"));

export const cursor = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("arcCursor").withIndex("by_name", (q) => q.eq("name", "arc")).unique())?.block ?? null,
});

/** One indexed block range, all or nothing: snapshots, positions, events and the cursor move together. */
export const apply = internalMutation({
  args: {
    name: v.string(),
    block: v.number(),
    markets: v.array(schema.tables.arcMarkets.validator),
    positions: v.array(schema.tables.arcPositions.validator),
    events: v.array(schema.tables.arcEvents.validator),
  },
  handler: async (ctx, { name, block, markets, positions, events }) => {
    for (const p of positions) {
      const row = await ctx.db
        .query("arcPositions")
        .withIndex("by_position", (q) => q.eq("kind", p.kind).eq("marketId", p.marketId).eq("user", p.user).eq("side", p.side))
        .unique();
      if (row) await ctx.db.patch(row._id, { amount: p.amount, amountUsd: p.amountUsd });
      else await ctx.db.insert("arcPositions", p);
    }
    for (const m of markets) {
      const row = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", m.kind).eq("marketId", m.marketId)).unique();
      // Overlapping runs: never let an older snapshot overwrite a newer one.
      if (row && row.updatedBlock > m.updatedBlock) continue;
      const participants = m.kind === "pool"
        ? new Set((await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("kind", "pool").eq("marketId", m.marketId)).collect()).map((p) => p.user)).size
        : m.participants;
      if (row) await ctx.db.replace(row._id, { ...m, participants });
      else await ctx.db.insert("arcMarkets", { ...m, participants });
    }
    for (const e of events) {
      const seen = await ctx.db.query("arcEvents").withIndex("by_log", (q) => q.eq("txHash", e.txHash).eq("logIndex", e.logIndex)).unique();
      if (!seen) await ctx.db.insert("arcEvents", e);
    }
    const c = await ctx.db.query("arcCursor").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (!c) await ctx.db.insert("arcCursor", { name, block });
    else if (block > c.block) await ctx.db.patch(c._id, { block });
  },
});

/** Public markets, newest first; optionally one kind and/or one status. */
export const markets = query({
  args: { kind: v.optional(kind), status: v.optional(status), limit: v.optional(v.number()) },
  handler: async (ctx, { kind, status, limit }) => {
    const rows = await ctx.db.query("arcMarkets").order("desc").collect();
    // ponytail: full scan + filter; add a by_status index once there are thousands of markets.
    return rows
      .filter((m) => !m.isPrivate && (!kind || m.kind === kind) && (!status || m.status === status))
      .slice(0, Math.min(limit ?? 100, 500));
  },
});

export const market = query({
  args: { kind, marketId: v.number() },
  handler: async (ctx, { kind, marketId }) => {
    const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).unique();
    if (!m) return null;
    const [positions, events] = await Promise.all([
      ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).collect(),
      ctx.db.query("arcEvents").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).order("desc").take(100),
    ]);
    return { ...m, positions, events };
  },
});

/** Everything one Arc account holds, with its market. */
export const positionsOf = query({
  args: { user: v.string() },
  handler: async (ctx, { user }) => {
    const rows = await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", user.toLowerCase())).collect();
    return Promise.all(
      rows.map(async (p) => ({
        ...p,
        market: await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", p.kind).eq("marketId", p.marketId)).unique(),
      })),
    );
  },
});

/**
 * Run the indexer now instead of waiting for the next cron tick: the app calls
 * this right after a create or stake lands, so the page catches up in seconds.
 */
// ponytail: unauthenticated and unthrottled (each call is one indexer run, idempotent); add a per-minute cap if it is abused.
export const poke = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.arcSync.sync, {});
  },
});
