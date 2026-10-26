import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
const kind = v.union(v.literal("vs"), v.literal("pool"));
export const forWorker = internalQuery({ args: { kind, marketId: v.number() }, handler: async (ctx, a) =>
  ctx.db.query("councilOpinions").withIndex("by_market", (q) => q.eq("kind", a.kind).eq("marketId", a.marketId)).take(30) });
export const forMarket = query({ args: { kind, marketId: v.number() }, handler: async (ctx, a) => {
  const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", a.kind).eq("marketId", a.marketId)).unique();
  if (!m || m.isPrivate) return [];
  return (await ctx.db.query("councilOpinions").withIndex("by_market", (q) => q.eq("kind", a.kind).eq("marketId", a.marketId)).take(30))
    .map(({ slug, lean, confidence, text, evidenceHash, at }) => ({ slug, lean, confidence, text, evidenceHash, at }));
} });
/** Counts attempts before a model call. Failed calls consume quota too. */
export const claim = internalMutation({ args: { creator: v.string() }, handler: async (ctx, { creator }) => {
  let house = ""; try { house = String(JSON.parse(process.env.ARC_CREATOR_WALLET ?? "null")?.address ?? "").toLowerCase(); } catch { /* no exemption */ }
  const day = new Date().toISOString().slice(0, 10), limit = Math.min(30, Math.max(0, Number(process.env.COUNCIL_TAKES_PER_CREATOR_DAY ?? 3) || 0));
  const row = await ctx.db.query("councilForecastBudgets").withIndex("by_creator", (q) => q.eq("creator", creator)).unique();
  const calls = row?.day === day ? row.calls : 0;
  if (creator !== house && calls >= limit) return false;
  if (row) await ctx.db.patch(row._id, { day, calls: calls + 1 }); else await ctx.db.insert("councilForecastBudgets", { creator, day, calls: 1 });
  return true;
} });
export const record = internalMutation({ args: { kind, marketId: v.number(), slug: v.string(), lean: v.number(), confidence: v.number(), text: v.string(), evidenceHash: v.string() }, handler: async (ctx, a) => {
  const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", a.kind).eq("marketId", a.marketId)).unique();
  if (!m || m.isPrivate || (a.lean !== 1 && a.lean !== 2)) return;
  const previous = await ctx.db.query("councilOpinions").withIndex("by_persona_market", (q) => q.eq("slug", a.slug).eq("kind", a.kind).eq("marketId", a.marketId)).unique();
  const at = Date.now(), value = { ...a, text: a.text.slice(0, 600), at };
  if (previous) await ctx.db.replace(previous._id, value); else await ctx.db.insert("councilOpinions", value);
  if (!previous || previous.lean !== a.lean || previous.evidenceHash !== a.evidenceHash) {
    const type = !previous ? "forecast" : previous.lean !== a.lean ? "opinion_changed" : "evidence_updated";
    await ctx.db.insert("discoverySignals", { marketKind: a.kind, marketId: a.marketId, category: m.category, slug: a.slug, type,
      text: `${a.slug}: ${type === "opinion_changed" ? "changed direction" : type === "evidence_updated" ? "source evidence updated" : "new forecast"}, leans ${a.lean === 1 ? m.labelA : m.labelB}. ${m.question}`, at });
  }
} });
