// Mimir Launch: hosted agents' records. Writes come only from the web server with MIMIR_LAUNCH_SECRET
// (lib/launch/flow.ts); the public views never return a sealed key, a wallet id or the uid.
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { secretMatches } from "../lib/internal-secrets";

function allowed(secret: string) {
  if (!secretMatches("launch", secret)) throw new Error("not allowed");
}

const bySlug = (ctx: QueryCtx | MutationCtx, slug: string) =>
  ctx.db.query("launchAgents").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();

const vBrain = v.union(
  v.object({ kind: v.literal("mimir") }),
  v.object({ kind: v.literal("byok"), provider: v.string(), sealed: v.string(), last4: v.string(), model: v.string() }),
);

const log = (ctx: MutationCtx, agent: Doc<"launchAgents">["_id"], kind: string, text: string, extra: { chain?: "solana" | "arc"; tx?: string } = {}) =>
  ctx.db.insert("launchEvents", { agent, at: Date.now(), kind, text: text.slice(0, 300), ...extra });

export const createPending = mutation({
  args: {
    secret: v.string(), slug: v.string(), uid: v.string(), owner: v.string(), name: v.string(), ticker: v.string(), avatarSeed: v.string(), thesis: v.string(),
    brain: vBrain,
    trading: v.object({ enabled: v.boolean(), config: v.any(), risk: v.any() }),
    markets: v.object({ enabled: v.boolean(), rules: v.any(), budgetUsdc: v.number() }),
    solana: v.object({ walletId: v.string(), address: v.string() }),
    arc: v.object({ walletId: v.string(), address: v.string() }),
    fundLamports: v.string(), description: v.string(), image: v.optional(v.string()),
  },
  handler: async (ctx, { secret, fundLamports, description, image, ...a }) => {
    allowed(secret);
    // Tickers may repeat (every token has its own mint); the slug in the URL stays unique: odin, odin-2, ...
    let slug = a.slug;
    for (let n = 2; await bySlug(ctx, slug); n++) {
      if (n > 999) return { ok: false as const };
      slug = `${a.slug}-${n}`;
    }
    await ctx.db.insert("launchAgents", { ...a, slug, status: "pending", createdAt: Date.now(), launch: { fundLamports, description, ...(image ? { image } : {}) } });
    return { ok: true as const, slug };
  },
});

export const forLaunch = query({
  args: { secret: v.string(), slug: v.string() },
  handler: async (ctx, { secret, slug }) => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    return a && { owner: a.owner, name: a.name, ticker: a.ticker, avatarSeed: a.avatarSeed, status: a.status, mint: a.mint ?? null, solana: a.solana ?? null, launch: a.launch ?? null };
  },
});

/**
 * Only one request may mint, even on a double click. The verified funding signature is bound to this agent:
 * the same tx can be retried for it, but never fund another agent's launch.
 */
export const claimLaunch = mutation({
  args: { secret: v.string(), slug: v.string(), fundingSig: v.string() },
  handler: async (ctx, { secret, slug, fundingSig }): Promise<boolean | "sig-used"> => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    if (!a || !a.launch || a.status !== "pending" || a.mint || a.launch.claimedAt) return false;
    const users = await ctx.db.query("launchAgents").withIndex("by_fundingSig", (q) => q.eq("fundingSig", fundingSig)).collect();
    if (users.some((u) => u._id !== a._id)) return "sig-used";
    await ctx.db.patch(a._id, { fundingSig, launch: { ...a.launch, claimedAt: Date.now() } });
    return true;
  },
});

/** The mint provably did not happen: let the owner retry. Never once a mint exists. */
export const releaseLaunch = mutation({
  args: { secret: v.string(), slug: v.string() },
  handler: async (ctx, { secret, slug }) => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    if (a?.launch && !a.mint) await ctx.db.patch(a._id, { launch: { ...a.launch, claimedAt: undefined } });
  },
});

/** The token exists. A kill during the launch stays a kill; a recorded mint is never replaced. */
export const recordLaunch = mutation({
  args: { secret: v.string(), slug: v.string(), mint: v.string(), metadataUri: v.string(), sig: v.string() },
  handler: async (ctx, { secret, slug, mint, metadataUri, sig }) => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    if (!a?.launch) throw new Error("no such agent");
    if (!a.launch.claimedAt) throw new Error("launch not claimed");
    if (a.mint && a.mint !== mint) throw new Error(`agent already has mint ${a.mint}`);
    if (a.mint) return;
    // The uploaded image is on IPFS now: drop it from the record.
    await ctx.db.patch(a._id, { mint, status: a.status === "killed" ? "killed" : "live", launch: { ...a.launch, image: undefined, metadataUri, sig } });
    await log(ctx, a._id, "rules", `launched $${a.ticker} on pump.fun, getting to work`, { chain: "solana", tx: sig });
  },
});

export const logEvent = mutation({
  args: { secret: v.string(), slug: v.string(), kind: v.union(v.literal("rules"), v.literal("error")), text: v.string() },
  handler: async (ctx, { secret, slug, kind, text }) => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    if (a) await log(ctx, a._id, kind, text);
  },
});

/** Only the owner; never out of 'killed'; a pending agent can only be killed. */
export const setStatus = mutation({
  args: { secret: v.string(), slug: v.string(), owner: v.string(), status: v.union(v.literal("live"), v.literal("paused"), v.literal("killed")) },
  handler: async (ctx, { secret, slug, owner, status }) => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    if (!a || a.owner !== owner || a.status === "killed" || (a.status === "pending" && status !== "killed")) return false;
    await ctx.db.patch(a._id, { status, ...(status === "live" ? { sleepUntil: undefined } : {}) });
    await log(ctx, a._id, "rules", status === "killed" ? "shut down by its owner: closing positions" : `${status === "live" ? "resumed" : "paused"} by its owner`);
    return true;
  },
});

// ---------------- public views ----------------

const publicView = (a: Doc<"launchAgents">) => ({
  slug: a.slug, owner: a.owner, name: a.name, ticker: a.ticker, avatarSeed: a.avatarSeed, thesis: a.thesis, status: a.status,
  brain: a.brain.kind === "byok" ? { kind: "byok" as const, provider: a.brain.provider, last4: a.brain.last4, model: a.brain.model } : a.brain,
  trading: { enabled: a.trading.enabled }, markets: { enabled: a.markets.enabled, budgetUsdc: a.markets.budgetUsdc },
  solana: a.solana?.address ?? null, arc: a.arc?.address ?? null, mint: a.mint ?? null, createdAt: a.createdAt,
  fundLamports: a.status === "pending" ? (a.launch?.fundLamports ?? null) : null,
});

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const a = await bySlug(ctx, slug);
    if (!a) return null;
    const events = await ctx.db.query("launchEvents").withIndex("by_agent", (q) => q.eq("agent", a._id)).order("desc").take(50);
    return { ...publicView(a), events: events.map((e) => ({ at: e.at, kind: e.kind, text: e.text, chain: e.chain ?? null, tx: e.tx ?? null })) };
  },
});

export const byOwner = query({
  args: { owner: v.string() },
  handler: async (ctx, { owner }) =>
    (await ctx.db.query("launchAgents").withIndex("by_owner", (q) => q.eq("owner", owner)).order("desc").take(50)).map(publicView),
});

// ---------------- the Arc market tick (convex/launchArc.ts) ----------------

/**
 * Live agents with markets on whose turn it is, claimed for this tick: lastTickAt moves first, so an overlapping
 * run skips them (one worker per agent). The sealed brain goes only to the internal action.
 */
export const claimMarketAgents = internalMutation({
  args: { now: v.number(), everyMs: v.number(), max: v.number() },
  handler: async (ctx, { now, everyMs, max }) => {
    const live = await ctx.db.query("launchAgents").withIndex("by_status", (q) => q.eq("status", "live")).take(500);
    const due = live.filter((a) => a.markets.enabled && a.arc && (a.lastTickAt ?? 0) <= now - everyMs).sort((a, b) => (a.lastTickAt ?? 0) - (b.lastTickAt ?? 0)).slice(0, max);
    for (const a of due) await ctx.db.patch(a._id, { lastTickAt: now });
    return Promise.all(due.map(async (a) => {
      const stakes = await ctx.db.query("launchStakes").withIndex("by_agent", (q) => q.eq("agent", a._id)).collect();
      // Money still out: stakes on markets that have not settled yet.
      let openUsdc = 0;
      for (const s of stakes) {
        const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", s.kind).eq("marketId", s.marketId)).unique();
        if (!m || !["resolved", "cancelled"].includes(m.status)) openUsdc += s.usdc;
      }
      return { id: a._id, uid: a.uid, thesis: a.thesis, brain: a.brain, markets: a.markets, arc: a.arc!, held: stakes.map((s) => `${s.kind}:${s.marketId}`), openUsdc };
    }));
  },
});

export const recordStake = internalMutation({
  args: { agent: v.id("launchAgents"), kind: v.union(v.literal("vs"), v.literal("pool")), marketId: v.number(), side: v.number(), usdc: v.number(), p: v.number(), edge: v.number(), why: v.string(), tx: v.string(), text: v.string() },
  handler: async (ctx, { text, ...s }) => {
    await ctx.db.insert("launchStakes", { ...s, at: Date.now() });
    await log(ctx, s.agent, "stake", text, { chain: "arc", tx: s.tx });
  },
});

export const note = internalMutation({
  args: { agent: v.id("launchAgents"), kind: v.string(), text: v.string(), pause: v.optional(v.boolean()) },
  handler: async (ctx, { agent, kind, text, pause }) => {
    await log(ctx, agent, kind, text);
    const a = await ctx.db.get(agent);
    if (pause && a?.status === "live") await ctx.db.patch(agent, { status: "paused" });
  },
});
