import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { secretMatches } from "../lib/internal-secrets";
import { assertMarketDeployment } from "./marketDeploymentGuard";

const hosted = v.object({ walletId: v.string(), address: v.string(), sealed: v.string() });
const allowed = (s: string) => { if (!secretMatches("launch", s)) throw new Error("Not authorized"); };
export const forFollower = query({
  args: { secret: v.string(), agent: v.string(), follower: v.string() },
  handler: async (ctx, a) => {
    allowed(a.secret); await assertMarketDeployment(ctx);
    const s = await ctx.db.query("launchCopies").withIndex("by_agent_follower", q => q.eq("agent", a.agent).eq("follower", a.follower)).unique();
    return s ? { active: s.active, pausedReason: s.pausedReason ?? null, solana: s.solana ? { address: s.solana.address, on: s.solana.on, maxPerStakeUsdc: s.solana.maxPerStakeUsdc } : null } : null;
  },
});
export const save = mutation({
  args: { secret: v.string(), agent: v.string(), follower: v.string(), active: v.boolean(), on: v.boolean(), maxPerStakeUsdc: v.number(), freshWallet: v.optional(hosted) },
  handler: async (ctx, a) => {
    allowed(a.secret); await assertMarketDeployment(ctx);
    if (!Number.isFinite(a.maxPerStakeUsdc) || a.maxPerStakeUsdc < 2 || a.maxPerStakeUsdc > 50) throw new Error("Stake cap must be 2–50 test USDC");
    const s = await ctx.db.query("launchCopies").withIndex("by_agent_follower", q => q.eq("agent", a.agent).eq("follower", a.follower)).unique();
    // Identity AND ciphertext stay together when two initial requests race.
    const wallet = s?.solana ?? a.freshWallet;
    if (!wallet) { if (s) await ctx.db.patch(s._id, { active: false }); return null; }
    const solana = { walletId: wallet.walletId, address: wallet.address, sealed: wallet.sealed, on: a.on, maxPerStakeUsdc: a.maxPerStakeUsdc };
    const patch = { solana, active: a.active, pausedReason: undefined };
    if (s) await ctx.db.patch(s._id, patch);
    else await ctx.db.insert("launchCopies", { agent: a.agent, follower: a.follower, createdAt: Date.now(), ...patch });
    return solana.address;
  },
});
export const subscribers = internalQuery({
  args: { agent: v.string() },
  handler: async (ctx, { agent }) => {
    await assertMarketDeployment(ctx);
    return (await ctx.db.query("launchCopies").withIndex("by_agent", q => q.eq("agent", agent)).take(100)).filter(s => s.active && s.solana?.on).map(s => s._id);
  },
});
export const privateSub = internalQuery({
  args: { id: v.id("launchCopies") },
  handler: async (ctx, { id }) => { await assertMarketDeployment(ctx); return ctx.db.get(id); },
});
export const walletForFollower = internalQuery({
  args: { agent: v.string(), follower: v.string() },
  handler: async (ctx, a) => {
    await assertMarketDeployment(ctx);
    const s = await ctx.db.query("launchCopies").withIndex("by_agent_follower", q => q.eq("agent", a.agent).eq("follower", a.follower)).unique();
    return s?.solana ? { id: s._id, wallet: s.solana } : null;
  },
});
