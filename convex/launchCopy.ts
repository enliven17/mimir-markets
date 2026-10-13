// Mimir Launch copy trading: subscriptions, the copy wallets' Solana holdings and the per-follower copy jobs
// (lib/launch/worker/copy.ts). The web server (MIMIR_LAUNCH_SECRET) creates and changes subscriptions; the agent ticks
// fan out jobs (convex/launchCopyJobs.ts). Subscriptions are keyed by lib/launch/copy-key.ts ("council:<slug>",
// "launch:<slug>"), so a launched agent can never reach a council persona's followers.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { secretMatches } from "../lib/internal-secrets";
import { launchCopyKey } from "../lib/launch/copy-key";
import { keepStoredWallet } from "../lib/launch/worker/copy";

function allowed(secret: string) {
  if (!secretMatches("launch", secret)) throw new Error("not allowed");
}

const sub = (ctx: QueryCtx | MutationCtx, agent: string, follower: string) =>
  ctx.db.query("launchCopies").withIndex("by_agent_follower", (q) => q.eq("agent", agent).eq("follower", follower)).unique();

const position = (ctx: QueryCtx | MutationCtx, s: Id<"launchCopies">, mint: string) =>
  ctx.db.query("launchCopyPositions").withIndex("by_sub_mint", (q) => q.eq("sub", s).eq("mint", mint)).unique();

const job = (ctx: QueryCtx | MutationCtx, key: string) => ctx.db.query("launchCopyJobs").withIndex("by_key", (q) => q.eq("key", key)).unique();

const vSol = v.object({ walletId: v.string(), address: v.string(), maxPerTradeLamports: v.string(), on: v.boolean() });
const vArc = v.object({ walletId: v.string(), address: v.string(), maxPerStakeUsdc: v.number(), on: v.boolean() });

// ---------------- web side ----------------

/** The follower's subscription with its wallet ids (server only: the route never returns walletId). `agent` is a copy key. */
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

/**
 * Start or change a subscription. A side's wallet, once stored, is never replaced: two racing first requests may each
 * make a wallet, but only the first one stored is kept and returned (the other was never handed out, so it is empty).
 * Returns the stored copy wallet addresses.
 */
export const upsert = mutation({
  args: { secret: v.string(), agent: v.string(), follower: v.string(), solana: v.optional(vSol), arc: v.optional(vArc), active: v.boolean() },
  handler: async (ctx, { secret, agent, follower, solana, arc, active }): Promise<{ solana: string | null; arc: string | null }> => {
    allowed(secret);
    const s = await sub(ctx, agent, follower);
    const sol = keepStoredWallet(s?.solana, solana), a = keepStoredWallet(s?.arc, arc);
    const patch = { ...(sol ? { solana: sol } : {}), ...(a ? { arc: a } : {}), active, pausedReason: undefined };
    if (s) await ctx.db.patch(s._id, patch);
    else await ctx.db.insert("launchCopies", { agent, follower, ...patch, createdAt: Date.now() });
    return { solana: sol?.address ?? null, arc: a?.address ?? null };
  },
});

/** The follower's "sell my copied tokens": stops new Solana copies and schedules the drain (launchCopyJobs.drain). */
export const requestDrain = mutation({
  args: { secret: v.string(), agent: v.string(), follower: v.string() },
  handler: async (ctx, { secret, agent, follower }): Promise<boolean> => {
    allowed(secret);
    const s = await sub(ctx, agent, follower);
    if (!s?.solana) return false;
    await ctx.db.patch(s._id, { solana: { ...s.solana, on: false } });
    await ctx.scheduler.runAfter(0, internal.launchCopyJobs.drain, { sub: s._id });
    return true;
  },
});

// ---------------- fan-out (the agent ticks) ----------------

/** Solana copy subscriptions of a launch agent (by its id): active, with the Solana side on. */
export const solSubs = internalQuery({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a) return [];
    const subs = await ctx.db.query("launchCopies").withIndex("by_agent", (q) => q.eq("agent", launchCopyKey(a.slug))).collect();
    return subs.filter((s) => s.active && s.solana?.on).map((s) => ({ id: s._id as string }));
  },
});

/** Every subscription of the agent (active or not) whose copy wallet holds `mint`. */
export const holders = internalQuery({
  args: { id: v.id("launchAgents"), mint: v.string() },
  handler: async (ctx, { id, mint }) => {
    const a = await ctx.db.get(id);
    if (!a) return [];
    const subs = await ctx.db.query("launchCopies").withIndex("by_agent", (q) => q.eq("agent", launchCopyKey(a.slug))).collect();
    const out: { id: string }[] = [];
    for (const s of subs) if (s.solana && (await position(ctx, s._id, mint))) out.push({ id: s._id });
    return out;
  },
});

/** Arc copy subscriptions behind a copy key (launch agent or council persona): active, with the Arc side on. */
export const arcSubs = internalQuery({
  args: { agent: v.string() },
  handler: async (ctx, { agent }) =>
    (await ctx.db.query("launchCopies").withIndex("by_agent", (q) => q.eq("agent", agent)).collect()).filter((s) => s.active && s.arc?.on).map((s) => ({ id: s._id as string })),
});

// ---------------- one follower's job ----------------

export const solSub = internalQuery({
  args: { sub: v.id("launchCopies") },
  handler: async (ctx, { sub: id }) => {
    const s = await ctx.db.get(id);
    return s?.solana ? { id: s._id as string, follower: s.follower, walletId: s.solana.walletId, wallet: s.solana.address, maxPerTradeLamports: s.solana.maxPerTradeLamports, active: s.active, on: s.solana.on } : null;
  },
});

export const arcSub = internalQuery({
  args: { sub: v.id("launchCopies") },
  handler: async (ctx, { sub: id }) => {
    const s = await ctx.db.get(id);
    return s?.arc ? { id: s._id as string, follower: s.follower, walletId: s.arc.walletId, wallet: s.arc.address, maxPerStakeUsdc: s.arc.maxPerStakeUsdc, active: s.active, on: s.arc.on } : null;
  },
});

export const held = internalQuery({
  args: { sub: v.id("launchCopies"), mint: v.string() },
  handler: async (ctx, { sub: s, mint }): Promise<string> => (await position(ctx, s, mint))?.tokens ?? "0",
});

/** Every mint the subscription ever copied or holds (for the drain). */
export const copiedMints = internalQuery({
  args: { sub: v.id("launchCopies") },
  handler: async (ctx, { sub: s }): Promise<string[]> => {
    const out = new Set<string>();
    for (const p of await ctx.db.query("launchCopyPositions").withIndex("by_sub", (q) => q.eq("sub", s)).collect()) out.add(p.mint);
    for (const j of await ctx.db.query("launchCopyJobs").withIndex("by_sub", (q) => q.eq("sub", s)).collect()) if (j.kind === "buy" && j.mint && j.sig) out.add(j.mint);
    return [...out];
  },
});

/** Takes a job's key once. */
export const claim = internalMutation({
  args: { key: v.string(), sub: v.id("launchCopies"), kind: v.union(v.literal("buy"), v.literal("sell"), v.literal("arc")) },
  handler: async (ctx, a): Promise<boolean> => {
    if (await job(ctx, a.key)) return false;
    await ctx.db.insert("launchCopyJobs", { ...a, status: "running", at: Date.now() });
    return true;
  },
});

export const buySigned = internalMutation({
  args: { key: v.string(), mint: v.string(), sig: v.string(), lastValidBlockHeight: v.number() },
  handler: async (ctx, { key, mint, sig, lastValidBlockHeight }) => {
    const j = await job(ctx, key);
    if (j && j.status === "running") await ctx.db.patch(j._id, { mint, sig, lastValidBlockHeight });
  },
});

/** The tokens a copy buy got, added to the position once per job, closing the job as done. */
export const addFill = internalMutation({
  args: { key: v.string(), sub: v.id("launchCopies"), mint: v.string(), tokens: v.string(), costLamports: v.string() },
  handler: async (ctx, a) => {
    const j = await job(ctx, a.key);
    if (j?.status === "done") return;
    if (j) await ctx.db.patch(j._id, { status: "done", mint: a.mint });
    if (BigInt(a.tokens) <= 0n) return;
    const row = await position(ctx, a.sub, a.mint);
    if (row) await ctx.db.patch(row._id, { tokens: (BigInt(row.tokens) + BigInt(a.tokens)).toString(), costLamports: (BigInt(row.costLamports) + BigInt(a.costLamports)).toString() });
    else await ctx.db.insert("launchCopyPositions", { sub: a.sub, mint: a.mint, tokens: a.tokens, costLamports: a.costLamports });
  },
});

export const finish = internalMutation({
  args: { key: v.string(), status: v.union(v.literal("done"), v.literal("failed"), v.literal("unknown"), v.literal("skipped")), note: v.optional(v.string()) },
  handler: async (ctx, { key, status, note }) => {
    const j = await job(ctx, key);
    if (j && j.status !== "done") await ctx.db.patch(j._id, { status, ...(note ? { note: note.slice(0, 200) } : {}) });
  },
});

export const settleSell = internalMutation({
  args: { sub: v.id("launchCopies"), mint: v.string(), held: v.string(), left: v.string() },
  handler: async (ctx, { sub: s, mint, held: h0, left }) => {
    const row = await position(ctx, s, mint);
    if (!row) return;
    const h = BigInt(h0), l = BigInt(left);
    if (l <= 0n || h <= 0n) await ctx.db.delete(row._id);
    else await ctx.db.patch(row._id, { tokens: l.toString(), costLamports: ((BigInt(row.costLamports) * l) / h).toString() });
  },
});

export const pauseForGate = internalMutation({
  args: { sub: v.id("launchCopies") },
  handler: async (ctx, { sub: s }) => void (await ctx.db.patch(s, { active: false, pausedReason: "no $MIMIR" })),
});

/** Copy buys to settle by signature: signed but never recorded ("unknown", or "running" for over 10 minutes). */
export const unsettledBuys = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, { before }) => {
    const rows = [
      ...(await ctx.db.query("launchCopyJobs").withIndex("by_status", (q) => q.eq("status", "unknown")).collect()),
      ...(await ctx.db.query("launchCopyJobs").withIndex("by_status", (q) => q.eq("status", "running")).collect()).filter((j) => j.at < before),
    ];
    const out = [];
    for (const j of rows) {
      if (j.kind !== "buy" || !j.mint || !j.sig || j.lastValidBlockHeight === undefined) continue;
      const s = await ctx.db.get(j.sub);
      if (s?.solana) out.push({ key: j.key, sub: j.sub as string, mint: j.mint, sig: j.sig, lastValidBlockHeight: j.lastValidBlockHeight, wallet: s.solana.address });
    }
    return out;
  },
});
