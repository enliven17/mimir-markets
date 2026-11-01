// Mimir Launch copy staking: subscriptions and the per-follower copy jobs (lib/launch/copy-stake.ts). The web server
// (MIMIR_LAUNCH_SECRET) creates and changes subscriptions; the agent ticks fan out jobs (convex/launchCopyJobs.ts).
// Subscriptions are keyed by lib/launch/copy-key.ts ("council:<slug>", "launch:<slug>"), so a launched agent can never
// reach a council persona's followers.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { secretMatches } from "../lib/internal-secrets";
import { keepStoredWallet } from "../lib/launch/copy-stake";

function allowed(secret: string) {
  if (!secretMatches("launch", secret)) throw new Error("not allowed");
}

const sub = (ctx: QueryCtx | MutationCtx, agent: string, follower: string) =>
  ctx.db.query("launchCopies").withIndex("by_agent_follower", (q) => q.eq("agent", agent).eq("follower", follower)).unique();

const job = (ctx: QueryCtx | MutationCtx, key: string) => ctx.db.query("launchCopyJobs").withIndex("by_key", (q) => q.eq("key", key)).unique();

const vArc = v.object({ walletId: v.string(), address: v.string(), maxPerStakeUsdc: v.number(), on: v.boolean() });

// ---------------- web side ----------------

/** The follower's subscription with its wallet id (server only: the route never returns walletId). `agent` is a copy key. */
export const forFollower = query({
  args: { secret: v.string(), agent: v.string(), follower: v.string() },
  handler: async (ctx, { secret, agent, follower }) => {
    allowed(secret);
    const s = await sub(ctx, agent, follower);
    if (!s) return null;
    return { arc: s.arc ?? null, active: s.active, pausedReason: s.pausedReason ?? null };
  },
});

/**
 * Start or change a subscription. The copy wallet, once stored, is never replaced: two racing first requests may each
 * make a wallet, but only the first one stored is kept and returned (the other was never handed out, so it is empty).
 * Returns the stored copy wallet address.
 */
export const upsert = mutation({
  args: { secret: v.string(), agent: v.string(), follower: v.string(), arc: v.optional(vArc), active: v.boolean() },
  handler: async (ctx, { secret, agent, follower, arc, active }): Promise<{ arc: string | null }> => {
    allowed(secret);
    const s = await sub(ctx, agent, follower);
    const a = keepStoredWallet(s?.arc, arc);
    const patch = { ...(a ? { arc: a } : {}), active, pausedReason: undefined };
    if (s) await ctx.db.patch(s._id, patch);
    else await ctx.db.insert("launchCopies", { agent, follower, ...patch, createdAt: Date.now() });
    return { arc: a?.address ?? null };
  },
});

// ---------------- fan-out (the agent ticks) ----------------

/** Arc copy subscriptions behind a copy key (launch agent or council persona): active, with copying on. */
export const arcSubs = internalQuery({
  args: { agent: v.string() },
  handler: async (ctx, { agent }) =>
    (await ctx.db.query("launchCopies").withIndex("by_agent", (q) => q.eq("agent", agent)).collect()).filter((s) => s.active && s.arc?.on).map((s) => ({ id: s._id as string })),
});

// ---------------- one follower's job ----------------

export const arcSub = internalQuery({
  args: { sub: v.id("launchCopies") },
  handler: async (ctx, { sub: id }) => {
    const s = await ctx.db.get(id);
    return s?.arc ? { id: s._id as string, follower: s.follower, walletId: s.arc.walletId, wallet: s.arc.address, maxPerStakeUsdc: s.arc.maxPerStakeUsdc, active: s.active, on: s.arc.on } : null;
  },
});

/** Takes a job's key once. */
export const claim = internalMutation({
  args: { key: v.string(), sub: v.id("launchCopies") },
  handler: async (ctx, a): Promise<boolean> => {
    if (await job(ctx, a.key)) return false;
    await ctx.db.insert("launchCopyJobs", { ...a, status: "running", at: Date.now() });
    return true;
  },
});

export const finish = internalMutation({
  args: { key: v.string(), status: v.union(v.literal("done"), v.literal("failed"), v.literal("unknown"), v.literal("skipped")), note: v.optional(v.string()) },
  handler: async (ctx, { key, status, note }) => {
    const j = await job(ctx, key);
    if (j && j.status !== "done") await ctx.db.patch(j._id, { status, ...(note ? { note: note.slice(0, 200) } : {}) });
  },
});
