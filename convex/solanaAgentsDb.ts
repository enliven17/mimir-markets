import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { assertMarketDeployment } from "./marketDeploymentGuard";

export const walletForOwner = internalQuery({
  args: { slug: v.string(), owner: v.string() },
  handler: async (ctx, { slug, owner }) => {
    await assertMarketDeployment(ctx);
    const a = await ctx.db.query("launchAgents").withIndex("by_slug", q => q.eq("slug", slug)).unique();
    return a?.owner === owner ? a.solana ?? null : null;
  },
});
export const opened = internalQuery({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    await assertMarketDeployment(ctx);
    const a = await ctx.db.get(id); if (!a?.solana) return { today: 0, lastAt: 0 };
    const since = Math.floor(Date.now() / 86_400_000) * 86_400;
    const rows = await ctx.db.query("arcMarkets").withIndex("by_creator", q => q.eq("creator", a.solana!.address)).take(1000);
    const saved = await ctx.db.query("launchMarkets").withIndex("by_agent", q => q.eq("agent", id)).order("desc").take(50);
    return { today: Math.max(rows.filter(m => m.createdAt >= since).length, saved.filter(m => m.at >= since * 1000).length),
      lastAt: Math.max(0, ...rows.map(m => m.createdAt * 1000), ...saved.map(m => m.at)) };
  },
});
