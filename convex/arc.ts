import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import schema, { status } from "./schema";
import { orderDecisions, retryDelayMs } from "../lib/oracle-queue";

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
    // What changed, for Telegram (arcSync posts these to /api/telegram/arc-events).
    const changes: Array<{ type: "new" | "proposed" | "resolved" | "cancelled"; kind: "vs" | "pool"; marketId: number }> = [];
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
      if (!row) changes.push({ type: "new", kind: m.kind, marketId: m.marketId });
      else if (row.status !== m.status && (m.status === "proposed" || m.status === "resolved" || m.status === "cancelled")) {
        changes.push({ type: m.status, kind: m.kind, marketId: m.marketId });
      }
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
    return changes;
  },
});

/** Public markets, newest first; optionally one kind and/or one status. */
export const markets = query({
  args: { kind: v.optional(kind), status: v.optional(status), limit: v.optional(v.number()) },
  handler: async (ctx, { kind, status, limit }) => {
    const n = Math.min(limit ?? 100, 500);
    // Bounded reads: by state (newest deadline first) when one is asked for, else the newest markets.
    const rows = status
      ? await ctx.db.query("arcMarkets").withIndex("by_status_deadline", (q) => q.eq("status", status)).order("desc").take(n * 4)
      : await ctx.db.query("arcMarkets").order("desc").take(n * 4);
    return rows.filter((m) => !m.isPrivate && (!kind || m.kind === kind)).slice(0, n);
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
    const rows = await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", user.toLowerCase())).order("desc").take(500);
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
// Public (the browser calls it), so debounced: at most one extra indexer run per POKE_GAP_MS for everyone together.
const POKE_GAP_MS = 5_000;
export const poke = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const last = await ctx.db.query("arcHeartbeats").withIndex("by_name", (q) => q.eq("name", "arc-poke")).unique();
    if (last && now - last.at < POKE_GAP_MS) return;
    if (last) await ctx.db.patch(last._id, { at: now });
    else await ctx.db.insert("arcHeartbeats", { name: "arc-poke", at: now });
    await ctx.scheduler.runAfter(0, internal.arcSync.sync, {});
  },
});

// ── Oracle bookkeeping (convex/arcOracle.ts) ────────────────────────────────

/** How many decisions one oracle tick is offered (arcOracle takes the first few), and how far each scan reads. */
const DECIDE_BATCH = 12;
const SCAN = 400;

/** Everything the oracle may do right now, from the index. `now` in unix seconds. Every read is bounded. */
export const oracleWork = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    type M = Doc<"arcMarkets">;
    // Past their deadline, by state: VS needs a challenger to be decided ("active"); a pool is decided once open.
    const due = async (st: M["status"]) =>
      ctx.db.query("arcMarkets").withIndex("by_status_deadline", (q) => q.eq("status", st).lte("deadline", now)).take(SCAN);
    const [active, open, proposed, disputed] = await Promise.all([due("active"), due("open"), due("proposed"), due("disputed")]);
    const undecided = [...active.filter((m) => m.kind === "vs"), ...open.filter((m) => m.kind === "pool")];

    const ready: M[] = [];
    for (const m of undecided) {
      if (m.refundAt <= now) continue;
      const t = await ctx.db.query("arcOracleTries").withIndex("by_market", (q) => q.eq("kind", m.kind).eq("marketId", m.marketId)).unique();
      if (!t || t.notBefore <= now * 1000) ready.push(m);
    }
    const decide = orderDecisions(
      ready.map((m) => ({ ...m, pot: BigInt(m.stakeA) + BigInt(m.stakeB) })),
      DECIDE_BATCH,
      now,
    ).map(({ pot: _pot, ...m }) => m as M);

    const finalize = proposed.filter((m) => m.disputableUntil > 0 && m.disputableUntil <= now);
    const refund = [...undecided, ...disputed].filter((m) => m.refundAt <= now).slice(0, 50);

    // Pool payouts still owed: settled in the last 30 days (older ones anyone can claim themselves).
    const since = now - 30 * 86_400;
    const settledPools = async (st: M["status"]) =>
      (await ctx.db.query("arcMarkets").withIndex("by_status_deadline", (q) => q.eq("status", st).gte("deadline", since)).order("desc").take(200)).filter(
        (m) => m.kind === "pool",
      );
    const pay: Array<{ marketId: number; users: string[] }> = [];
    for (const m of [...(await settledPools("resolved")), ...(await settledPools("cancelled"))]) {
      const contested = BigInt(m.stakeA) > 0n && BigInt(m.stakeB) > 0n;
      const legs = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("kind", "pool").eq("marketId", m.marketId)).take(500);
      // Winners only on a contested A/B outcome (losers have nothing to claim); everyone on a refund.
      const owed = legs.filter((p) => !p.claimed && (!contested || (m.winner !== 1 && m.winner !== 2) || p.side === m.winner));
      const users = [...new Set(owed.map((p) => p.user))];
      if (users.length) pay.push({ marketId: m.marketId, users });
      if (pay.length >= 50) break;
    }
    const pick = ({ kind, marketId }: { kind: "vs" | "pool"; marketId: number }) => ({ kind, marketId });
    return { decide, finalize: finalize.slice(0, 50).map(pick), refund: refund.map(pick), pay };
  },
});

/** A deferred or failed decision: try this market again later, backing off exponentially (lib/oracle-queue.ts). */
export const deferMarket = internalMutation({
  args: { kind, marketId: v.number(), error: v.optional(v.string()) },
  handler: async (ctx, { kind, marketId, error }) => {
    const row = await ctx.db.query("arcOracleTries").withIndex("by_market", (q) => q.eq("kind", kind).eq("marketId", marketId)).unique();
    const attempts = (row?.attempts ?? 0) + 1;
    const next = { notBefore: Date.now() + retryDelayMs(attempts), lastError: error?.slice(0, 500) };
    if (row) await ctx.db.patch(row._id, { ...next, attempts });
    else await ctx.db.insert("arcOracleTries", { kind, marketId, attempts, ...next });
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
    // Bounded: the next 2000 markets by deadline.
    (await ctx.db.query("arcMarkets").withIndex("by_deadline", (q) => q.gt("deadline", closesAfter)).take(2000)).filter(
      (m) => !m.isPrivate && (m.status === "open" || m.status === "active"),
    ),
});

/** Every market one address opened (lowercase), any status. */
export const marketsBy = internalQuery({
  args: { creator: v.string() },
  handler: async (ctx, { creator }) => ctx.db.query("arcMarkets").withIndex("by_creator", (q) => q.eq("creator", creator.toLowerCase())).order("desc").take(2000),
});
