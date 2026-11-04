import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { assertMarketDeployment } from "./marketDeploymentGuard";

/** Leases fence concurrent cron/manual invocations before any chain transaction. */
export const lease = internalMutation({
  args: { name: v.string(), token: v.string(), ttlMs: v.number() },
  handler: async (ctx, { name, token, ttlMs }) => {
    await assertMarketDeployment(ctx);
    const row = await ctx.db.query("solanaWorkers").withIndex("by_name", q => q.eq("name", name)).unique();
    const now = Date.now();
    if (row && row.leaseUntil > now) return false;
    const next = { name, token, leaseUntil: now + Math.min(ttlMs, 540_000), startedAt: now, finishedAt: row?.finishedAt ?? 0, status: "running", note: "" };
    if (row) await ctx.db.patch(row._id, next); else await ctx.db.insert("solanaWorkers", next);
    return true;
  },
});
export const finish = internalMutation({
  args: { name: v.string(), token: v.string(), ok: v.boolean(), note: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("solanaWorkers").withIndex("by_name", q => q.eq("name", a.name)).unique();
    if (row?.token === a.token) await ctx.db.patch(row._id, { leaseUntil: 0, finishedAt: Date.now(), status: a.ok ? "ok" : "error", note: a.note.slice(0, 240) });
  },
});
export const recentSignatures = internalQuery({
  args: {},
  handler: async ctx => (await ctx.db.query("arcEvents").order("desc").take(200)).map(e => e.txHash),
});
export const beat = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const row = await ctx.db.query("arcHeartbeats").withIndex("by_name", q => q.eq("name", name)).unique();
    if (row) await ctx.db.patch(row._id, { at: Date.now() });
    else await ctx.db.insert("arcHeartbeats", { name, at: Date.now() });
  },
});
export const health = query({
  args: {},
  handler: async ctx => {
    await assertMarketDeployment(ctx);
    const jobs = await ctx.db.query("solanaWorkers").take(20);
    return { network: "solana-devnet", workers: jobs.map(({ name, startedAt, finishedAt, status }) => ({ name, startedAt, finishedAt, status })) };
  },
});
