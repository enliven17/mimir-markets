import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { secretMatches } from "../lib/internal-secrets";
import { opinionSplit, signalMatches } from "../lib/discovery";
import { seriesForMarket } from "../lib/market-series";
function allowed(secret: string) { if (!secretMatches("launch", secret)) throw new Error("not allowed"); }
export const sweep = internalMutation({ args: {}, handler: async (ctx) => {
  if (process.env.MIMIR_BACKEND_OFF === "1") return;
  const expired = await ctx.db.query("discoverySignals").withIndex("by_at", (q) => q.lt("at", Date.now() - 31 * 86_400_000)).take(500);
  for (const row of expired) await ctx.db.delete(row._id);
} });

export const radar = query({ args: {}, handler: async (ctx) => {
  const markets = (await ctx.db.query("arcMarkets").withIndex("by_deadline", (q) => q.gt("deadline", Date.now() / 1000)).take(150)).filter((m) => !m.isPrivate && (m.status === "open" || m.status === "active"));
  const out = [];
  for (const m of markets) {
    const decisions = await ctx.db.query("arcCouncilDecisions").withIndex("by_market", (q) => q.eq("kind", m.kind).eq("marketId", m.marketId)).take(30);
    const take = await ctx.db.query("arcMarketTakes").withIndex("by_market", (q) => q.eq("kind", m.kind).eq("marketId", m.marketId)).first();
    const opinions = decisions.filter((d) => d.outcome === "staked" || d.outcome === "abstained").map(({ slug, lean, at }) => ({ slug, lean, at }));
    const forecasts = await ctx.db.query("councilOpinions").withIndex("by_market", (q) => q.eq("kind", m.kind).eq("marketId", m.marketId)).take(30);
    for (const { slug, lean, at } of forecasts) opinions.push({ slug, lean, at });
    if (take && !opinions.some((d) => d.slug === take.slug && d.at >= take.at)) opinions.push({ slug: take.slug, lean: take.lean, at: take.at });
    const split = opinionSplit(opinions);
    if (split.a + split.b > 0) out.push({ kind: m.kind, marketId: m.marketId, question: m.question, labelA: m.labelA, labelB: m.labelB, category: m.category, deadline: m.deadline,
      resolutionUrl: m.resolutionUrl, ...split, updatedAt: Math.max(...opinions.map((o) => o.at)) });
  }
  return out.sort((a, b) => b.disagreement - a.disagreement || a.deadline - b.deadline).slice(0, 30);
} });

export const setFollow = mutation({ args: { secret: v.string(), owner: v.string(), target: v.string(), active: v.boolean() }, handler: async (ctx, { secret, owner, target, active }) => {
  allowed(secret);
  if (!/^(market:(vs|pool):\d+|topic:[a-z0-9-]{1,40}|agent:[a-z0-9-]{1,48}|series:[a-z0-9-]{1,48})$/.test(target)) throw new Error("Invalid follow target.");
  const row = await ctx.db.query("discoveryFollows").withIndex("by_owner_target", (q) => q.eq("owner", owner).eq("target", target)).unique();
  if (!active) { if (row) await ctx.db.delete(row._id); return { active: false }; }
  if (!row) {
    if ((await ctx.db.query("discoveryFollows").withIndex("by_owner", (q) => q.eq("owner", owner)).take(101)).length >= 100) throw new Error("Follow limit reached (100).");
    await ctx.db.insert("discoveryFollows", { owner, target, at: Date.now() });
  }
  return { active: true };
} });

export const inbox = query({ args: { secret: v.string(), owner: v.string() }, handler: async (ctx, { secret, owner }) => {
  allowed(secret);
  const follows = await ctx.db.query("discoveryFollows").withIndex("by_owner", (q) => q.eq("owner", owner)).take(100);
  const signals = await ctx.db.query("discoverySignals").withIndex("by_at", (q) => q.gte("at", Date.now() - 30 * 86_400_000)).order("desc").take(500);
  const items: { id: string; text: string; at: number; href: string }[] = [];
  for (const signal of signals) {
    const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", signal.marketKind).eq("marketId", signal.marketId)).unique();
    if (!m || m.isPrivate || !follows.some((f) => f.at <= signal.at && signalMatches(f.target, signal, seriesForMarket(m)))) continue;
    items.push({ id: signal._id, text: signal.text, at: signal.at, href: `/arena/arc/${signal.marketKind}/${signal.marketId}` });
    if (items.length >= 40) break;
  }
  for (const f of follows) if (f.target.startsWith("market:")) {
    const [, kind, id] = f.target.split(":");
    const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", kind as "vs" | "pool").eq("marketId", Number(id))).unique();
    if (m && !m.isPrivate && m.deadline * 1000 > Date.now() && m.deadline * 1000 - Date.now() < 3_600_000) items.push({ id: `closing:${f.target}`, text: `Closing within an hour: ${m.question}`, at: m.deadline * 1000 - 3_600_000, href: `/arena/arc/${kind}/${id}` });
  }
  return { follows: follows.map(({ target }) => target), items: items.sort((a, b) => b.at - a.at).slice(0, 50) };
} });
