import { v } from "convex/values";
import { query } from "./_generated/server";
import { secretMatches } from "../lib/internal-secrets";
import { verifiedPoolSavings } from "../lib/token-benefits";
export const usage = query({ args: { secret: v.string(), owner: v.string(), arc: v.optional(v.string()) }, handler: async (ctx, { secret, owner, arc }) => {
  if (!secretMatches("launch", secret)) throw new Error("not allowed");
  const start = new Date(); const since = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1) / 1000;
  const demo = await ctx.db.query("demoSessions").withIndex("by_owner", (q) => q.eq("owner", owner)).unique();
  const agents = demo ? await ctx.db.query("demoAgents").withIndex("by_session", (q) => q.eq("session", demo._id)).take(3) : [];
  const events = arc ? await ctx.db.query("arcEvents").withIndex("by_user", (q) => q.eq("user", arc.toLowerCase())).order("desc").take(1001) : [];
  const entries = events.filter((e) => e.kind === "pool" && e.name === "Staked" && e.at !== undefined && e.at >= since);
  const markets = [...new Set(entries.map((e) => e.marketId))].slice(0, 50);
  let limited = events.length > 1000 || markets.length < new Set(entries.map((e) => e.marketId)).size;
  const savings = { entries: 0, gross: 0n, paid: 0n, saved: 0n };
  for (const id of markets) {
    const rows = await ctx.db.query("arcEvents").withIndex("by_market", (q) => q.eq("kind", "pool").eq("marketId", id)).take(5001);
    if (rows.length > 5000) { limited = true; continue; }
    const result = verifiedPoolSavings(rows, arc!, since);
    savings.entries += result.entries; savings.gross += BigInt(result.gross); savings.paid += BigInt(result.paid); savings.saved += BigInt(result.saved);
  }
  return { month: new Date(since * 1000).toISOString().slice(0, 7), arc: arc ?? null, limited,
    entryFees: { ...savings, gross: savings.gross.toString(), paid: savings.paid.toString(), saved: savings.saved.toString() },
    preview: { expiresAt: demo?.expiresAt ?? null, tier: demo?.mimirTier ?? "none", agents: agents.length, aiCallsToday: agents.reduce((sum, a) => sum + (a.aiDay === Math.floor(Date.now() / 86_400_000) ? a.aiCalls ?? 0 : 0), 0) } };
} });
