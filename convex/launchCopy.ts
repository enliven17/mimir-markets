// Mimir Launch copy trading: subscriptions and the copy wallets' Solana holdings (lib/launch/worker/copy.ts).
// The web server (MIMIR_LAUNCH_SECRET) creates and changes subscriptions; the Solana and Arc ticks read them.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { secretMatches } from "../lib/internal-secrets";

function allowed(secret: string) {
  if (!secretMatches("launch", secret)) throw new Error("not allowed");
}

const sub = (ctx: QueryCtx | MutationCtx, agent: string, follower: string) =>
  ctx.db.query("launchCopies").withIndex("by_agent_follower", (q) => q.eq("agent", agent).eq("follower", follower)).unique();

const position = (ctx: QueryCtx | MutationCtx, s: Id<"launchCopies">, mint: string) =>
  ctx.db.query("launchCopyPositions").withIndex("by_sub_mint", (q) => q.eq("sub", s).eq("mint", mint)).unique();

const vSol = v.object({ walletId: v.string(), address: v.string(), maxPerTradeLamports: v.string(), on: v.boolean() });
const vArc = v.object({ walletId: v.string(), address: v.string(), maxPerStakeUsdc: v.number(), on: v.boolean() });

// ---------------- web side ----------------

/** The follower's subscription with its wallet ids (server only: the route never returns walletId). */
export const forFollower = query({
  args: { secret: v.string(), agent: v.string(), follower: v.string() },
  handler: async (ctx, { secret, agent, follower }) => {
    allowed(secret);
    const s = await sub(ctx, agent, follower);
    if (!s) return null;
    const held = await ctx.db.query("launchCopyPositions").withIndex("by_sub", (q) => q.eq("sub", s._id)).collect();
    return { solana: s.solana ?? null, arc: s.arc ?? null, active: s.active, pausedReason: s.pausedReason ?? null, holdings: held.map((p) => ({ mint: p.mint, tokens: p.tokens })) };
  },
});

/** Start or change a subscription. A side's wallet, once made, is kept: turning a side off only stops new entries. */
export const upsert = mutation({
  args: { secret: v.string(), agent: v.string(), follower: v.string(), solana: v.optional(vSol), arc: v.optional(vArc), active: v.boolean() },
  handler: async (ctx, { secret, agent, follower, solana, arc, active }) => {
    allowed(secret);
    const s = await sub(ctx, agent, follower);
    const patch = { ...(solana ? { solana } : {}), ...(arc ? { arc } : {}), active, pausedReason: undefined };
    if (s) await ctx.db.patch(s._id, patch);
    else await ctx.db.insert("launchCopies", { agent, follower, ...patch, createdAt: Date.now() });
  },
});

// ---------------- worker side ----------------

/** Solana copy subscriptions of a launch agent (by its id): active, with the Solana side on. */
export const solSubs = internalQuery({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a) return [];
    const subs = await ctx.db.query("launchCopies").withIndex("by_agent", (q) => q.eq("agent", a.slug)).collect();
    return subs
      .filter((s) => s.active && s.solana?.on)
      .map((s) => ({ id: s._id as string, follower: s.follower, walletId: s.solana!.walletId, wallet: s.solana!.address, maxPerTradeLamports: s.solana!.maxPerTradeLamports }));
  },
});

/** Every subscription of the agent (active or not) whose copy wallet holds `mint`. */
export const holders = internalQuery({
  args: { id: v.id("launchAgents"), mint: v.string() },
  handler: async (ctx, { id, mint }) => {
    const a = await ctx.db.get(id);
    if (!a) return [];
    const subs = await ctx.db.query("launchCopies").withIndex("by_agent", (q) => q.eq("agent", a.slug)).collect();
    const out: { id: string; walletId: string; wallet: string; tokens: string }[] = [];
    for (const s of subs) {
      if (!s.solana) continue;
      const p = await position(ctx, s._id, mint);
      if (p) out.push({ id: s._id, walletId: s.solana.walletId, wallet: s.solana.address, tokens: p.tokens });
    }
    return out;
  },
});

export const addPosition = internalMutation({
  args: { sub: v.id("launchCopies"), mint: v.string(), tokens: v.string(), costLamports: v.string() },
  handler: async (ctx, a) => {
    const row = await position(ctx, a.sub, a.mint);
    if (row) await ctx.db.patch(row._id, { tokens: (BigInt(row.tokens) + BigInt(a.tokens)).toString(), costLamports: (BigInt(row.costLamports) + BigInt(a.costLamports)).toString() });
    else await ctx.db.insert("launchCopyPositions", a);
  },
});

export const settleSell = internalMutation({
  args: { sub: v.id("launchCopies"), mint: v.string(), held: v.string(), left: v.string() },
  handler: async (ctx, { sub: s, mint, held, left }) => {
    const row = await position(ctx, s, mint);
    if (!row) return;
    const h = BigInt(held), l = BigInt(left);
    if (l <= 0n || h <= 0n) await ctx.db.delete(row._id);
    else await ctx.db.patch(row._id, { tokens: l.toString(), costLamports: ((BigInt(row.costLamports) * l) / h).toString() });
  },
});

export const pauseForGate = internalMutation({
  args: { sub: v.id("launchCopies") },
  handler: async (ctx, { sub: s }) => void (await ctx.db.patch(s, { active: false, pausedReason: "no $MIMIR" })),
});

/** Arc copy subscriptions of an agent slug (launch agent or council persona): active, with the Arc side on. */
export const arcSubs = internalQuery({
  args: { agent: v.string() },
  handler: async (ctx, { agent }) =>
    (await ctx.db.query("launchCopies").withIndex("by_agent", (q) => q.eq("agent", agent)).collect())
      .filter((s) => s.active && s.arc?.on)
      .map((s) => ({ id: s._id as string, follower: s.follower, walletId: s.arc!.walletId, wallet: s.arc!.address, maxPerStakeUsdc: s.arc!.maxPerStakeUsdc })),
});
