// Mimir Launch: hosted agents' records. Writes come only from the web server with MIMIR_LAUNCH_SECRET
// (lib/launch/flow.ts); the public views never return a sealed key, a wallet id or the uid.
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { secretMatches } from "../lib/internal-secrets";
import { reservedLaunchSlug } from "../lib/launch/copy-key";
import { allocationProblem } from "../lib/launch/fees";
import { vAllocation } from "./schema";

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
    markets: v.object({ enabled: v.boolean(), rules: v.any(), budgetUsdc: v.number(), create: v.optional(v.object({ enabled: v.boolean(), perDay: v.number() })) }),
    solana: v.object({ walletId: v.string(), address: v.string() }),
    arc: v.object({ walletId: v.string(), address: v.string() }),
    fundLamports: v.string(), description: v.string(), image: v.optional(v.string()),
    allocation: v.optional(vAllocation),
    chain: v.optional(v.union(v.literal("solana"), v.literal("arc"))),
    argus: v.optional(v.object({ buyTaxBps: v.number(), sellTaxBps: v.number() })),
  },
  handler: async (ctx, { secret, fundLamports, description, image, chain, argus, ...a }) => {
    allowed(secret);
    const problem = a.allocation ? allocationProblem(a.allocation) : null;
    if (problem) throw new Error(`allocation: ${problem}`);
    // Never a persona's or a house name (lib/launch/copy-key.ts), checked again here and for every suffixed try.
    if (reservedLaunchSlug(a.slug)) return { ok: false as const, reason: "reserved" as const };
    // Tickers may repeat (every token has its own mint); the slug in the URL stays unique: odin, odin-2, ...
    let slug = a.slug;
    for (let n = 2; reservedLaunchSlug(slug) || (await bySlug(ctx, slug)); n++) {
      if (n > 999) return { ok: false as const, reason: "taken" as const };
      slug = `${a.slug}-${n}`;
    }
    await ctx.db.insert("launchAgents", { ...a, slug, status: "pending", createdAt: Date.now(), launch: { fundLamports, description, ...(image ? { image } : {}), ...(chain === "arc" ? { chain, argus } : {}) } });
    return { ok: true as const, slug };
  },
});

export const forLaunch = query({
  args: { secret: v.string(), slug: v.string() },
  handler: async (ctx, { secret, slug }) => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    return a && {
      owner: a.owner, name: a.name, ticker: a.ticker, avatarSeed: a.avatarSeed, status: a.status, mint: a.mint ?? null, solana: a.solana ?? null, arc: a.arc ?? null, launch: a.launch ?? null,
      uid: a.uid, token: a.token ?? null, allocation: a.allocation ?? null, argusOwed6: a.argusFees?.owedTreasury6 ?? "0",
    };
  },
});

/**
 * Only one request may mint, even on a double click. The verified funding signature is bound to this agent:
 * the same tx can be retried for it, but never fund another agent's launch. An Argus launch has no funding tx (the
 * agent's Arc wallet pays its own gas), so only it may claim without one.
 */
export const claimLaunch = mutation({
  args: { secret: v.string(), slug: v.string(), fundingSig: v.optional(v.string()) },
  handler: async (ctx, { secret, slug, fundingSig }): Promise<boolean | "sig-used"> => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    if (!a || !a.launch || a.status !== "pending" || a.mint || a.token) return false;
    if (!fundingSig) {
      // An Argus retry is safe (a landed launch is recovered, never repeated), so a claim left by a request that died
      // mid-launch expires after 10 minutes instead of blocking the owner for good.
      if (a.launch.chain !== "arc" || (a.launch.claimedAt && a.launch.claimedAt > Date.now() - 10 * 60_000)) return false;
      await ctx.db.patch(a._id, { launch: { ...a.launch, claimedAt: Date.now() } });
      return true;
    }
    if (a.launch.claimedAt) return false;
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
    if (a?.launch && !a.mint && !a.token) await ctx.db.patch(a._id, { launch: { ...a.launch, claimedAt: undefined } });
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

/** Its Argus token exists (lib/launch/flow.ts launchArc). Same rules as recordLaunch: never replaced, a kill stays a kill. */
export const recordArgusLaunch = mutation({
  args: {
    secret: v.string(), slug: v.string(),
    token: v.object({ address: v.string(), poolId: v.string(), splitter: v.string(), hook: v.string(), locker: v.string(), creatorBps: v.number(), tx: v.optional(v.string()) }),
  },
  handler: async (ctx, { secret, slug, token }) => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    if (!a?.launch) throw new Error("no such agent");
    if (!a.launch.claimedAt) throw new Error("launch not claimed");
    if (a.token && a.token.address.toLowerCase() !== token.address.toLowerCase()) throw new Error(`agent already has token ${a.token.address}`);
    if (a.token) return;
    await ctx.db.patch(a._id, { token: { chain: "arc", ...token }, status: a.status === "killed" ? "killed" : "live", launch: { ...a.launch, image: undefined } });
    await log(ctx, a._id, "rules", `launched $${a.ticker} on Argus (Arc), getting to work`, { chain: "arc", ...(token.tx ? { tx: token.tx } : {}) });
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
    await ctx.db.patch(a._id, { status, ...(status === "live" ? { sleepUntil: undefined, idle: undefined } : {}) });
    await log(ctx, a._id, "rules", status === "killed" ? "shut down by its owner: closing Solana positions and returning its SOL (Arc stakes settle on their own; withdraw USDC any time)" : `${status === "live" ? "resumed" : "paused"} by its owner`);
    return true;
  },
});

// ---------------- public views ----------------

const publicView = (a: Doc<"launchAgents">) => ({
  slug: a.slug, owner: a.owner, name: a.name, ticker: a.ticker, avatarSeed: a.avatarSeed, thesis: a.thesis, status: a.status,
  brain: a.brain.kind === "byok" ? { kind: "byok" as const, provider: a.brain.provider, last4: a.brain.last4, model: a.brain.model } : a.brain,
  trading: { enabled: a.trading.enabled }, markets: { enabled: a.markets.enabled, budgetUsdc: a.markets.budgetUsdc },
  wallet: a.solana?.address ?? null, arc: a.arc?.address ?? null, mint: a.mint ?? null, createdAt: a.createdAt,
  chain: a.token ? ("arc" as const) : (a.launch?.chain ?? "solana"),
  token: a.token ? { address: a.token.address, poolId: a.token.poolId } : null,
  fundLamports: a.status === "pending" ? (a.launch?.fundLamports ?? null) : null,
});

/** The agent's card: what anyone may see (its face, token, wallets). */
export const card = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const a = await bySlug(ctx, slug);
    return a && a.status !== "pending" ? publicView(a) : null;
  },
});

/** The full agent page (reasoning log, trades, PnL): $MIMIR holders only, served by /api/launch/:id/detail. */
export const detail = query({
  args: { secret: v.string(), slug: v.string() },
  handler: async (ctx, { secret, slug }) => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    if (!a) return null;
    const events = await ctx.db.query("launchEvents").withIndex("by_agent", (q) => q.eq("agent", a._id)).order("desc").take(50);
    const positions = await ctx.db.query("launchPositions").withIndex("by_agent", (q) => q.eq("agent", a._id)).take(50);
    const trades = await ctx.db.query("launchTrades").withIndex("by_agent", (q) => q.eq("agent", a._id)).order("desc").take(500);
    // Realized Solana PnL: closed (confirmed) sells carry their PnL.
    let pnl = 0n, wins = 0, losses = 0;
    for (const t of trades) {
      if (t.side !== "sell" || t.status !== "confirmed" || t.pnlLamports === undefined) continue;
      const v = BigInt(t.pnlLamports);
      pnl += v;
      if (v > 0n) wins++;
      else if (v < 0n) losses++;
    }
    return {
      ...publicView(a),
      events: events.map((e) => ({ at: e.at, kind: e.kind, text: e.text, chain: e.chain ?? null, tx: e.tx ?? null })),
      solana: { pnlLamports: pnl.toString(), wins, losses, trades: trades.length, open: positions.map((p) => ({ mint: p.mint, symbol: p.symbol, costLamports: p.costLamports, openedAt: p.openedAt })) },
      recentTrades: trades.slice(0, 20).map((t) => ({ mint: t.mint, side: t.side, lamports: t.lamports, sig: t.sig, status: t.status, pnlLamports: t.pnlLamports ?? null, reason: t.reason, at: t.at })),
    };
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
/**
 * What an agent holds on Arc and how much is still out (unsettled), from the chain (the indexed positions) and from
 * our own records: a Circle call that timed out can still land, and the index sees it within seconds, so it is never
 * staked twice. Also used by convex/launchMarketsDb.ts for the seed stake of a market it opens.
 */
export async function holdings(ctx: QueryCtx | MutationCtx, a: Doc<"launchAgents">): Promise<{ held: string[]; openUsdc: number }> {
  if (!a.arc) return { held: [], openUsdc: 0 };
  const recorded = await ctx.db.query("launchStakes").withIndex("by_agent", (q) => q.eq("agent", a._id)).collect();
  const onChain = await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", a.arc!.address.toLowerCase())).collect();
  const out = new Map<string, number>();
  for (const p of onChain) out.set(`${p.kind}:${p.marketId}`, (out.get(`${p.kind}:${p.marketId}`) ?? 0) + Number(BigInt(p.amount)) / 1e18);
  for (const s of recorded) if (!out.has(`${s.kind}:${s.marketId}`)) out.set(`${s.kind}:${s.marketId}`, s.usdc);
  let openUsdc = 0;
  for (const [key, usdc] of out) {
    const [kind, id] = key.split(":");
    const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", kind as "vs" | "pool").eq("marketId", Number(id))).unique();
    if (!m || !["resolved", "cancelled"].includes(m.status)) openUsdc += usdc;
  }
  return { held: [...out.keys()], openUsdc };
}

export const claimMarketAgents = internalMutation({
  args: { now: v.number(), everyMs: v.number(), max: v.number() },
  handler: async (ctx, { now, everyMs, max }) => {
    const live = await ctx.db.query("launchAgents").withIndex("by_status", (q) => q.eq("status", "live")).take(500);
    const due = live.filter((a) => a.markets.enabled && a.arc && (a.lastTickAt ?? 0) <= now - everyMs).sort((a, b) => (a.lastTickAt ?? 0) - (b.lastTickAt ?? 0)).slice(0, max);
    for (const a of due) await ctx.db.patch(a._id, { lastTickAt: now });
    return Promise.all(due.map(async (a) => {
      const { held, openUsdc } = await holdings(ctx, a);
      return { id: a._id, slug: a.slug, uid: a.uid, thesis: a.thesis, brain: a.brain, markets: a.markets, arc: a.arc!, held, openUsdc };
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

/** The launch page's directory: launched agents (not pending), newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const status of ["live", "paused"] as const) {
      out.push(...(await ctx.db.query("launchAgents").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(100)));
    }
    return out.filter((a) => !a.house).sort((a, b) => b.createdAt - a.createdAt).map(publicView);
  },
});

/**
 * Any Arc address's record on Mimir markets, from the index: every position with its market and outcome. `pnl` is
 * the pari-mutuel result before fees (won: its share of the losing side; lost: minus the stake; open or refunded: 0).
 */
export const arcRecord = query({
  args: { secret: v.string(), address: v.string() },
  handler: async (ctx, { secret, address }) => {
    allowed(secret);
    const user = address.toLowerCase();
    const positions = await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", user)).order("desc").take(300);
    const bets = [];
    for (const p of positions) {
      const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", p.kind).eq("marketId", p.marketId)).unique();
      if (!m) continue;
      const usdc = Number(BigInt(p.amount)) / 1e18;
      const same = Number(BigInt(p.side === 1 ? m.stakeA : m.stakeB)) / 1e18, other = Number(BigInt(p.side === 1 ? m.stakeB : m.stakeA)) / 1e18;
      const outcome = m.status === "cancelled" || (m.status === "resolved" && m.winner > 2) ? "refunded" : m.status !== "resolved" ? "open" : m.winner === p.side ? "won" : "lost";
      const pnl = outcome === "won" ? (same > 0 ? (usdc / same) * other : 0) : outcome === "lost" ? -usdc : 0;
      bets.push({ kind: p.kind, marketId: p.marketId, side: p.side, label: p.side === 1 ? m.labelA : m.labelB, question: m.question, usdc, outcome, pnl, deadline: m.deadline });
    }
    return bets;
  },
});

/**
 * The owner's withdrawal takes the agent's lease like a tick does (one spender per wallet at a time). Returns the
 * lease token, or null while a tick or another withdrawal holds it.
 */
export const leaseForOwner = mutation({
  args: { secret: v.string(), slug: v.string(), owner: v.string() },
  handler: async (ctx, { secret, slug, owner }): Promise<number | null> => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    const now = Date.now();
    if (!a || a.owner !== owner || (a.leaseUntil !== undefined && a.leaseUntil > now)) return null;
    const until = now + 3 * 60_000;
    await ctx.db.patch(a._id, { leaseUntil: until });
    return until;
  },
});

export const releaseForOwner = mutation({
  args: { secret: v.string(), slug: v.string(), token: v.number() },
  handler: async (ctx, { secret, slug, token }) => {
    allowed(secret);
    const a = await bySlug(ctx, slug);
    if (a?.leaseUntil === token) await ctx.db.patch(a._id, { leaseUntil: undefined });
  },
});
