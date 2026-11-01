// Mimir Launch: agents opening their own markets (convex/launchMarkets.ts does the chain work). The hourly cron is a
// cheap mutation: it only schedules an action for agents whose owner turned it on, that are under their daily count,
// and whose last market is a few hours old. Gated by LAUNCH_ARC=1 and its own LAUNCH_AGENT_MARKETS=1.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { holdings } from "./launch";
import { AGENT_MARKETS_PER_DAY_MAX } from "../lib/launch/agent-markets-limit";
import { vChain } from "./schema";

/** At least this long between two markets from one agent. */
const SPACING_MS = 3 * 3600_000;

const dayStart = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/**
 * Today's count and the last one, from our records and from the chain index (by its Arc and Base wallets): a Circle
 * call that timed out but landed is not in our records, and must still count. One draft opened on two chains (one
 * pairKey) counts once.
 */
async function opened(ctx: QueryCtx, agent: Id<"launchAgents">, wallets: Array<string | undefined>, now: number) {
  const rows = await ctx.db.query("launchMarkets").withIndex("by_agent", (q) => q.eq("agent", agent).gte("at", dayStart(now))).collect();
  const last = await ctx.db.query("launchMarkets").withIndex("by_agent", (q) => q.eq("agent", agent)).order("desc").first();
  const drafts = new Set(rows.map((r) => r.pairKey ?? r._id)).size;
  let chainToday = 0;
  let chainLast = 0;
  for (const w of new Set(wallets.filter((x): x is string => Boolean(x)).map((x) => x.toLowerCase()))) {
    const onChain = await ctx.db.query("arcMarkets").withIndex("by_creator", (q) => q.eq("creator", w)).order("desc").take(50);
    chainToday = Math.max(chainToday, onChain.filter((m) => m.createdAt * 1000 >= dayStart(now)).length);
    chainLast = Math.max(chainLast, (onChain[0]?.createdAt ?? 0) * 1000);
  }
  return { today: Math.max(drafts, chainToday), lastAt: Math.max(last?.at ?? 0, chainLast) };
}

const perDay = (a: Doc<"launchAgents">) => Math.min(AGENT_MARKETS_PER_DAY_MAX, Math.max(1, Math.floor(a.markets.create?.perDay ?? 1)));

export const createAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Opening markets has its own switch (LAUNCH_AGENT_MARKETS=1) on top of LAUNCH_ARC: staking can run without it.
    if (process.env.MIMIR_BACKEND_OFF === "1" || process.env.LAUNCH_ARC !== "1" || process.env.LAUNCH_AGENT_MARKETS !== "1") return 0;
    const now = Date.now();
    let n = 0;
    for (const a of await ctx.db.query("launchAgents").withIndex("by_status", (q) => q.eq("status", "live")).collect()) {
      if (!a.markets.create?.enabled || !a.arc || (a.leaseUntil ?? 0) > now) continue;
      const o = await opened(ctx, a._id, [a.arc?.address, a.base?.address], now);
      if (o.today >= perDay(a) || now - o.lastAt < SPACING_MS) continue;
      await ctx.scheduler.runAfter(0, internal.launchMarkets.createOne, { id: a._id });
      n++;
    }
    return n;
  },
});

/** What the action needs: its brain, thesis, categories, chains, wallets, what is still out, and today's count. */
export const forCreate = internalQuery({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || a.status !== "live" || !a.arc || !a.markets.create?.enabled) return null;
    const now = Date.now();
    const o = await opened(ctx, a._id, [a.arc?.address, a.base?.address], now);
    if (o.today >= perDay(a) || now - o.lastAt < SPACING_MS) return null;
    const { openUsdc } = await holdings(ctx, a);
    const rules = (a.markets.rules ?? {}) as { categories?: string[]; chains?: Array<"arc" | "base"> };
    return { slug: a.slug, uid: a.uid, thesis: a.thesis, brain: a.brain, arc: a.arc, base: a.base ?? null, chains: rules.chains ?? [], categories: rules.categories ?? [], budgetUsdc: a.markets.budgetUsdc, openUsdc };
  },
});

export const record = internalMutation({
  args: {
    agent: v.id("launchAgents"), chain: vChain, pairKey: v.optional(v.string()), question: v.string(), category: v.string(), resolutionUrl: v.string(), deadline: v.number(),
    side: v.number(), seedUsdc: v.number(), tx: v.string(), why: v.string(),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("launchMarkets", { ...a, at: Date.now() });
    await ctx.db.insert("launchEvents", {
      agent: a.agent, at: Date.now(), kind: "market", chain: a.chain, tx: a.tx,
      text: `opened a market on ${a.chain === "base" ? "Base" : "Arc"}: "${a.question.slice(0, 120)}" (${a.category}), staking ${a.seedUsdc} USDC on its side`.slice(0, 300),
    });
  },
});
