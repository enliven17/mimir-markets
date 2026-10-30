// Mimir API (lib/launch/paid-call.ts): the agent a paid call reaches, and the one-call-per-tx ledger.
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { secretMatches } from "../lib/internal-secrets";

/** Where a caller may pay this agent: its own wallets. Null unless it is live. */
export const wallets = query({
  args: { secret: v.string(), slug: v.string() },
  handler: async (ctx, { secret, slug }) => {
    if (!secretMatches("launch", secret)) throw new Error("not allowed");
    const a = await ctx.db.query("launchAgents").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!a || a.status !== "live") return null;
    return { name: a.name, ticker: a.ticker, arc: a.arc?.address ?? null, solana: a.venue === "robinhood" ? null : (a.solana?.address ?? null), robinhood: a.robinhood?.address ?? null, base: a.base?.address ?? a.arc?.address ?? null };
  },
});

/** The agent with its brain (sealed key stays server side) and a little recent context for its answer. */
export const forCall = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const a = await ctx.db.query("launchAgents").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!a || a.status !== "live") return null;
    const events = await ctx.db.query("launchEvents").withIndex("by_agent", (q) => q.eq("agent", a._id)).order("desc").take(12);
    return {
      id: a._id, uid: a.uid, name: a.name, ticker: a.ticker, thesis: a.thesis, brain: a.brain, fundingSig: a.fundingSig ?? null,
      arc: a.arc?.address ?? null, solana: a.venue === "robinhood" ? null : (a.solana?.address ?? null), robinhood: a.robinhood?.address ?? null,
      // Base pays (MimirAgentPay) go to its Base wallet, or else its Arc EOA (same address on every EVM chain).
      base: a.base?.address ?? a.arc?.address ?? null,
      recent: events.filter((e) => e.kind !== "api").map((e) => e.text),
    };
  },
});

/** False when this tx already bought a call (or is being used by one right now). */
export const claim = internalMutation({
  args: { key: v.string(), agent: v.string(), units: v.string() },
  handler: async (ctx, { key, agent, units }) => {
    if (await ctx.db.query("agentApiPayments").withIndex("by_key", (q) => q.eq("key", key)).first()) return false;
    await ctx.db.insert("agentApiPayments", { key, agent, units, at: Date.now() });
    return true;
  },
});

/** The agent could not answer: the payment may buy a retry. */
export const release = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const p = await ctx.db.query("agentApiPayments").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (p && !p.done) await ctx.db.delete(p._id);
  },
});

export const done = internalMutation({
  args: { key: v.string(), logTo: v.optional(v.id("launchAgents")), text: v.string(), chain: v.union(v.literal("solana"), v.literal("arc"), v.literal("robinhood"), v.literal("base")), tx: v.string() },
  handler: async (ctx, { key, logTo, text, chain, tx }) => {
    const p = await ctx.db.query("agentApiPayments").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (p) await ctx.db.patch(p._id, { done: true });
    if (logTo) await ctx.db.insert("launchEvents", { agent: logTo, at: Date.now(), kind: "api", text: text.slice(0, 300), chain, tx });
  },
});
