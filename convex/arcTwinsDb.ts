// The twin reconciler's reads and writes (convex/arcTwins.ts runs it; lib/chains/twins.ts decides). Every read bounded.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { vChain } from "./schema";
import { sameMarket } from "../lib/chains/twins";

type Chain = "arc" | "base";
const chainOf = (r: { chain?: Chain }): Chain => r.chain ?? "arc";
const status = v.union(v.literal("waiting"), v.literal("sending"), v.literal("sent"), v.literal("linked"), v.literal("skipped"), v.literal("failed"));

/**
 * Open public pools still taking stakes after `closesAfter` (unix s) that lack a leg on one of `enabled`, oldest first,
 * each with what the planner needs: the chains it already has, the creator's side, its triage and its twin rows.
 */
export const candidates = internalQuery({
  args: { closesAfter: v.number(), enabled: v.array(vChain), limit: v.optional(v.number()) },
  handler: async (ctx, { closesAfter, enabled, limit }) => {
    const rows = (await ctx.db.query("arcMarkets").withIndex("by_deadline", (q) => q.gt("deadline", closesAfter)).take(1500)).filter(
      (m) => m.kind === "pool" && m.status === "open" && !m.isPrivate && enabled.includes(chainOf(m)),
    );
    rows.sort((a, b) => a.createdAt - b.createdAt);
    const out = [];
    for (const m of rows) {
      const c = chainOf(m);
      const legs = m.pairKey ? (await ctx.db.query("arcMarkets").withIndex("by_pair", (q) => q.eq("pairKey", m.pairKey)).take(10)).map(chainOf) : [c];
      const missing = enabled.filter((e) => !legs.includes(e));
      if (!missing.length) continue;
      const opening = (await ctx.db.query("arcPositions").withIndex("by_position", (q) => q.eq("chain", c).eq("kind", "pool").eq("marketId", m.marketId).eq("user", m.creator)).take(2))[0];
      const triage = await ctx.db.query("arcTriage").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", "pool").eq("marketId", m.marketId)).first();
      const twins = await ctx.db.query("marketTwins").withIndex("by_source", (q) => q.eq("srcChain", c).eq("srcMarketId", m.marketId)).take(4);
      out.push({
        chain: c, kind: m.kind, marketId: m.marketId, creator: m.creator, question: m.question, labelA: m.labelA, labelB: m.labelB,
        resolutionUrl: m.resolutionUrl, category: m.category, deadline: m.deadline, createdAt: m.createdAt, lockAt: m.lockAt, status: m.status,
        isPrivate: m.isPrivate, pairKey: m.pairKey, creatorSide: opening?.side ?? null, missing,
        triage: triage ? { spam: triage.spam, resolvable: triage.resolvable } : null,
        twins: twins.map((t) => ({ chain: t.chain, status: t.status, notBefore: t.notBefore, attempts: t.attempts })),
      });
      if (out.length >= (limit ?? 40)) break;
    }
    return out;
  },
});

/**
 * The same pool already open on `chain` (lib/chains/twins.ts sameMarket), not linked to a different pair: the reconciler
 * links it instead of opening another (a twin whose link was lost, or the same question opened on both chains).
 */
export const findSame = internalQuery({
  args: { chain: vChain, pairKey: v.string(), question: v.string(), labelA: v.string(), labelB: v.string(), resolutionUrl: v.string(), deadline: v.number() },
  handler: async (ctx, a) => {
    const rows = await ctx.db.query("arcMarkets").withIndex("by_deadline", (q) => q.eq("deadline", a.deadline)).take(200);
    const hit = rows.find((m) => chainOf(m) === a.chain && m.kind === "pool" && !m.isPrivate && m.status !== "resolved" && (!m.pairKey || m.pairKey === a.pairKey) && sameMarket(m, a));
    return hit ? hit.marketId : null;
  },
});

/** Twins sent but not linked yet (their market id still to be read), oldest first. */
export const pending = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows: Doc<"marketTwins">[] = [
      ...(await ctx.db.query("marketTwins").withIndex("by_status", (q) => q.eq("status", "sending")).take(50)),
      ...(await ctx.db.query("marketTwins").withIndex("by_status", (q) => q.eq("status", "sent")).take(50)),
    ];
    return rows.sort((x, y) => x.at - y.at);
  },
});

/** The pool a create transaction opened, from the index (its MarketCreated event), or null until indexed. */
export const marketIdByTx = internalQuery({
  args: { chain: vChain, tx: v.string() },
  handler: async (ctx, { chain, tx }) => {
    const ev = (await ctx.db.query("arcEvents").withIndex("by_log", (q) => q.eq("txHash", tx)).take(20)).find((e) => chainOf(e) === chain && e.kind === "pool" && e.name === "MarketCreated");
    return ev ? ev.marketId : null;
  },
});

/** Twins the house opened (or is opening) today for one creator, for TWIN_PER_CREATOR_DAY. */
export const creatorToday = internalQuery({
  args: { creator: v.string(), day: v.string() },
  handler: async (ctx, { creator, day }) =>
    (await ctx.db.query("marketTwins").withIndex("by_creator_day", (q) => q.eq("creator", creator).eq("day", day)).take(100)).filter((t) => !t.house && (t.status === "sending" || t.status === "sent" || t.status === "linked")).length,
});

/** Write one (source, target chain) row: created on first sight, patched after. */
export const put = internalMutation({
  args: {
    srcChain: vChain,
    srcMarketId: v.number(),
    chain: vChain,
    pairKey: v.string(),
    creator: v.string(),
    house: v.boolean(),
    status,
    reason: v.optional(v.string()),
    tx: v.optional(v.string()),
    marketId: v.optional(v.number()),
    seed: v.optional(v.string()),
    day: v.optional(v.string()),
    bumpAttempts: v.optional(v.boolean()),
    notBefore: v.optional(v.number()),
  },
  handler: async (ctx, { bumpAttempts, notBefore, ...a }) => {
    const row = await ctx.db.query("marketTwins").withIndex("by_source", (q) => q.eq("srcChain", a.srcChain).eq("srcMarketId", a.srcMarketId).eq("chain", a.chain)).unique();
    const now = Date.now();
    const fields = Object.fromEntries(Object.entries(a).filter(([, x]) => x !== undefined)) as typeof a;
    if (row) await ctx.db.patch(row._id, { ...fields, attempts: row.attempts + (bumpAttempts ? 1 : 0), notBefore: notBefore ?? row.notBefore, at: now });
    else await ctx.db.insert("marketTwins", { ...fields, attempts: bumpAttempts ? 1 : 0, notBefore: notBefore ?? 0, at: now });
  },
});
