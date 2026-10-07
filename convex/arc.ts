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
      if (seen) continue;
      await ctx.db.insert("arcEvents", e);
      // A pool payout collected (by the user or pushed by the oracle): mark that user's legs paid.
      if (e.kind === "pool" && e.name === "Claimed" && e.user) {
        const legs = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("kind", "pool").eq("marketId", e.marketId)).collect();
        for (const p of legs) if (p.user === e.user) await ctx.db.patch(p._id, { claimed: true });
      }
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
      ctx.db.query("arcEvents").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).collect(),
    ]);
    // Every transaction on the market, newest first (chain order, not insertion order).
    events.sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
    const verdict = await ctx.db.query("arcVerdicts").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).order("desc").first();
    // Fees this market paid, from its FeeAccrued events: entry fees and copy-trade fees, all on chain.
    const feesCollected = events.filter((e) => e.name === "FeeAccrued").reduce((sum, e) => sum + BigInt(e.amount ?? "0"), 0n).toString();
    return { ...m, positions, events, verdict, feesCollected };
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

// ── Oracle bookkeeping (convex/arcOracle.ts) ────────────────────────────────

const RETRY_MS = 10 * 60_000;

/** Everything the oracle may do right now, from the index. `now` in unix seconds. */
export const oracleWork = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    // ponytail: full scan of the markets table each tick; add status/deadline indexes past a few thousand markets.
    const markets = await ctx.db.query("arcMarkets").collect();
    const tries = await ctx.db.query("arcOracleTries").collect();
    const waitUntil = new Map(tries.map((t) => [`${t.kind}:${t.marketId}`, t.notBefore]));
    const ready = (m: { kind: string; marketId: number }) => (waitUntil.get(`${m.kind}:${m.marketId}`) ?? 0) <= now * 1000;
    // VS needs a challenger to be decided ("active"); a pool is decided as soon as it has its creator's stake.
    const undecided = (m: (typeof markets)[number]) => (m.kind === "vs" ? m.status === "active" : m.status === "open");

    const decide = markets.filter((m) => undecided(m) && m.deadline <= now && m.refundAt > now && ready(m));
    const finalize = markets.filter((m) => m.status === "proposed" && m.disputableUntil > 0 && m.disputableUntil <= now);
    const refund = markets.filter((m) => (undecided(m) || m.status === "disputed") && m.refundAt <= now);
    const pay: Array<{ marketId: number; users: string[] }> = [];
    for (const m of markets) {
      if (m.kind !== "pool" || (m.status !== "resolved" && m.status !== "cancelled")) continue;
      const contested = BigInt(m.stakeA) > 0n && BigInt(m.stakeB) > 0n;
      const legs = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("kind", "pool").eq("marketId", m.marketId)).collect();
      // Winners only on a contested A/B outcome (losers have nothing to claim); everyone on a refund.
      const owed = legs.filter((p) => !p.claimed && (!contested || (m.winner !== 1 && m.winner !== 2) || p.side === m.winner));
      const users = [...new Set(owed.map((p) => p.user))];
      if (users.length) pay.push({ marketId: m.marketId, users });
    }
    const pick = ({ kind, marketId }: { kind: "vs" | "pool"; marketId: number }) => ({ kind, marketId });
    return { decide, finalize: finalize.map(pick), refund: refund.map(pick), pay };
  },
});

/** A deferred or failed decision: try this market again in RETRY_MS. */
export const deferMarket = internalMutation({
  args: { kind, marketId: v.number(), error: v.optional(v.string()) },
  handler: async (ctx, { kind, marketId, error }) => {
    const row = await ctx.db.query("arcOracleTries").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).unique();
    const next = { notBefore: Date.now() + RETRY_MS, lastError: error?.slice(0, 500) };
    if (row) await ctx.db.patch(row._id, { ...next, attempts: row.attempts + 1 });
    else await ctx.db.insert("arcOracleTries", { kind, marketId, attempts: 1, ...next });
  },
});

export const saveVerdict = internalMutation({
  args: schema.tables.arcVerdicts.validator,
  handler: async (ctx, verdict) => {
    await ctx.db.insert("arcVerdicts", verdict);
  },
});

/** The oracle's audit bundle for a market: what anyone can hash to check the on-chain evidenceHash. */
export const verdict = query({
  args: { kind, marketId: v.number() },
  handler: async (ctx, { kind, marketId }) =>
    (await ctx.db.query("arcVerdicts").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).order("desc").first()) ?? null,
});

export const marketWithPositions = internalQuery({
  args: { kind, marketId: v.number() },
  handler: async (ctx, { kind, marketId }) => {
    const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).unique();
    if (!m) return null;
    const positions = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).collect();
    return { ...m, positions };
  },
});

/** Markets still taking positions after `closesAfter` (unix seconds): VS open or active, pools open. */
export const openMarkets = internalQuery({
  args: { closesAfter: v.number() },
  handler: async (ctx, { closesAfter }) =>
    // ponytail: scans by deadline from closesAfter on; fine until there are thousands of future markets.
    (await ctx.db.query("arcMarkets").withIndex("by_deadline", (q) => q.gt("deadline", closesAfter)).collect()).filter(
      (m) => !m.isPrivate && (m.status === "open" || m.status === "active"),
    ),
});
