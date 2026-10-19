// Mimir Launch: the Solana worker's Repo (lib/launch/ports.ts) on Convex, internal only (ported from snipad
// convex/worker/repo.ts + lease.ts). Trade writes are idempotent on `sig` (a persist retried after a timeout never
// double-books a fill), cost basis scales on partial sells, a killed agent is never resurrected. Amounts are bigint
// decimal strings in the tables (launchPositions / launchTrades). A position is one row per open mint, deleted on close.
import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { wakeCheckDue } from "../lib/launch/worker/idle";
import { reservedOf } from "./launchFeeDb";

const vStatus = v.union(v.literal("pending"), v.literal("live"), v.literal("paused"), v.literal("killed"));
/** Longer than a Node action can run (10 min), so a lease never expires under a live action. */
const LEASE_MS = 11 * 60_000;

const hasOpen = async (ctx: QueryCtx, agent: Id<"launchAgents">) =>
  (await ctx.db.query("launchPositions").withIndex("by_agent", (q) => q.eq("agent", agent)).first()) !== null;

/** What the worker reads of an agent: never the sealed brain or the launch payload. */
/** The wallet the agent trades from: its Robinhood Chain wallet on that venue, else its Solana one. */
export const tradingWallet = (a: Doc<"launchAgents">) => (a.venue === "robinhood" ? a.robinhood : a.venue === "arc" ? undefined : a.solana);

const agentView = (a: Doc<"launchAgents">, reservedLamports = 0n) => ({
  // `owner` is where a shutdown sweep pays: the owner's Solana wallet, or on Robinhood its payout address.
  id: a._id as string, name: a.name, ticker: a.ticker, mint: a.mint ?? null, owner: a.venue === "robinhood" ? (a.robinhood?.payout ?? "") : a.owner,
  walletId: tradingWallet(a)?.walletId ?? "", wallet: tradingWallet(a)?.address ?? "", status: a.status,
  config: a.trading.config, risk: a.trading.risk, createdAt: a.createdAt, idle: a.idle ?? null,
  /** Owed out of the wallet (fee pools, payouts in flight, owed treasury): never traded or swept. Decimal string. */
  reservedLamports: reservedLamports.toString(),
});
export type AgentView = ReturnType<typeof agentView>;

const positionView = (p: Doc<"launchPositions">) => ({
  id: p._id as string, agent: p.agent as string, mint: p.mint, symbol: p.symbol, tokens: p.tokens, decimals: p.decimals ?? 6,
  costLamports: p.costLamports, entryPrice: p.entryPriceSol, highPrice: p.peakPriceSol, openedAt: p.openedAt,
});
export type PositionView = ReturnType<typeof positionView>;

/**
 * The cron (crons.ts): one tickOne action per agent due a Solana tick, so a slow agent never delays the others.
 * A mutation, not an action: with LAUNCH_SOLANA off or nobody due it costs no Node time. Due: launched (a mint),
 * trading on, a wallet, not leased; live ones (unless asleep with no check due), paused/killed ones with open
 * positions (exits keep running), killed ones not swept yet.
 */
export const tickAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.MIMIR_BACKEND_OFF === "1") return 0;
    const solanaOn = process.env.LAUNCH_SOLANA === "1";
    const robinhoodOn = process.env.LAUNCH_ROBINHOOD === "1";
    if (!solanaOn && !robinhoodOn) return 0;
    const now = Date.now();
    // ponytail: 500 per status in creation order; swept killed agents stay "killed", so past ~500 kills give them their own status.
    const of = (status: Doc<"launchAgents">["status"]) => ctx.db.query("launchAgents").withIndex("by_status", (q) => q.eq("status", status)).take(500);
    const [live, paused, killed] = await Promise.all([of("live"), of("paused"), of("killed")]);
    const due: Doc<"launchAgents">[] = live.filter((a) => wakeCheckDue(a.idle, now));
    for (const a of paused) if (await hasOpen(ctx, a._id)) due.push(a);
    for (const a of killed) if (a.sweptAt === undefined || (await hasOpen(ctx, a._id))) due.push(a);
    let n = 0;
    for (const a of due) {
      // A shut-down agent is swept even with trading off: its own token burned, its SOL back to the owner.
      if ((!a.trading.enabled && a.status !== "killed") || !tradingWallet(a) || !a.mint || (a.leaseUntil ?? 0) > now) continue;
      // Each venue has its own action and its own switch (LAUNCH_SOLANA, LAUNCH_ROBINHOOD).
      if (a.venue === "robinhood") {
        if (!robinhoodOn) continue;
        await ctx.scheduler.runAfter(0, internal.launchRh.tickOne, { id: a._id });
      } else {
        if (!solanaOn) continue;
        await ctx.scheduler.runAfter(0, internal.launchSol.tickOne, { id: a._id });
      }
      n++;
    }
    return n;
  },
});

/** The agent's brain for its ranker; only the internal action reads it. */
export const brain = internalQuery({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    return a ? { uid: a.uid, brain: a.brain } : null;
  },
});

export const agent = internalQuery({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    return a ? agentView(a, await reservedOf(ctx.db, a)) : null;
  },
});

export const openPositions = internalQuery({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) =>
    (await ctx.db.query("launchPositions").withIndex("by_agent", (q) => q.eq("agent", id)).collect()).sort((a, b) => a.openedAt - b.openedAt).map(positionView),
});

const vTrade = { lamports: v.string(), reason: v.string(), sig: v.string() };

export const openPosition = internalMutation({
  args: { agent: v.id("launchAgents"), mint: v.string(), symbol: v.string(), tokens: v.string(), decimals: v.number(), costLamports: v.string(), entryPrice: v.number(), highPrice: v.number(), buy: v.object(vTrade) },
  handler: async (ctx, a) => {
    const mine = () => ctx.db.query("launchPositions").withIndex("by_agent", (q) => q.eq("agent", a.agent)).collect();
    const dup = await ctx.db.query("launchTrades").withIndex("by_sig", (q) => q.eq("sig", a.buy.sig)).first();
    if (dup) {
      const existing = (await mine()).find((p) => p.mint === a.mint);
      if (!existing) throw new Error(`trade ${a.buy.sig} already recorded without a position`);
      return positionView(existing);
    }
    const now = Date.now();
    const symbol = a.symbol.slice(0, 32);
    const id = await ctx.db.insert("launchPositions", {
      agent: a.agent, mint: a.mint, symbol, tokens: a.tokens, decimals: a.decimals, costLamports: a.costLamports,
      entryPriceSol: a.entryPrice, peakPriceSol: a.highPrice, openedAt: now,
    });
    await ctx.db.insert("launchTrades", { agent: a.agent, mint: a.mint, side: "buy", lamports: a.buy.lamports, tokens: a.tokens, sig: a.buy.sig, status: "confirmed", reason: a.buy.reason.slice(0, 500), at: now });
    return positionView((await ctx.db.get(id))!);
  },
});

/** Close (`close`) or reduce a position; books the cost share of the sold tokens as PnL. */
export const sell = internalMutation({
  args: { positionId: v.id("launchPositions"), tokens: v.string(), close: v.boolean(), ...vTrade },
  handler: async (ctx, s) => {
    if (await ctx.db.query("launchTrades").withIndex("by_sig", (q) => q.eq("sig", s.sig)).first()) return null;
    const p = await ctx.db.get(s.positionId);
    if (!p) throw new Error(`position ${s.positionId} not found`);
    const [held, cost, sold, got] = [BigInt(p.tokens), BigInt(p.costLamports), BigInt(s.tokens), BigInt(s.lamports)];
    const full = s.close || sold >= held;
    const costPart = full || held === 0n ? cost : (cost * sold) / held;
    const pnl = got - costPart;
    if (full) await ctx.db.delete(p._id);
    else await ctx.db.patch(p._id, { tokens: (held - sold).toString(), costLamports: (cost - costPart).toString() });
    await ctx.db.insert("launchTrades", {
      agent: p.agent, mint: p.mint, side: "sell", lamports: s.lamports, tokens: s.tokens, sig: s.sig, status: "confirmed",
      pnlLamports: pnl.toString(), reason: s.reason.slice(0, 500), at: Date.now(),
    });
    return null;
  },
});

export const setHighPrice = internalMutation({
  args: { positionId: v.id("launchPositions"), price: v.number() },
  handler: async (ctx, { positionId, price }) => {
    if (!Number.isFinite(price) || price <= 0) return null;
    const p = await ctx.db.get(positionId);
    if (p && price > p.peakPriceSol) await ctx.db.patch(p._id, { peakPriceSol: price });
    return null;
  },
});

/** Realised PnL (sum of sell pnl) since UTC midnight, lamports as a decimal string. */
export const dailyPnl = internalQuery({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    const d = new Date();
    const since = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const rows = await ctx.db.query("launchTrades").withIndex("by_agent", (q) => q.eq("agent", id).gte("at", since)).collect();
    return rows.reduce((s, t) => (t.side === "sell" ? s + BigInt(t.pnlLamports ?? "0") : s), 0n).toString();
  },
});

export const logEvent = internalMutation({
  args: { id: v.id("launchAgents"), kind: v.string(), text: v.string() },
  handler: async (ctx, { id, kind, text }) => {
    await ctx.db.insert("launchEvents", { agent: id, at: Date.now(), kind, text: text.slice(0, 500), chain: "solana" });
    return null;
  },
});

export const setStatus = internalMutation({
  args: { id: v.id("launchAgents"), status: vStatus },
  handler: async (ctx, { id, status }) => {
    const a = await ctx.db.get(id);
    // Never resurrect or downgrade a killed agent.
    if (a && a.status !== "killed") await ctx.db.patch(id, { status });
    return null;
  },
});

export const markSwept = internalMutation({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (a?.status === "killed") await ctx.db.patch(id, { sweptAt: Date.now() });
    return null;
  },
});

/** Idle counter / sleep state from the tick. null = awake: clears everything, a wake request too. */
export const setIdle = internalMutation({
  args: { id: v.id("launchAgents"), idle: v.union(v.null(), v.object({ ticks: v.number(), sleepingSince: v.optional(v.number()), checkedAt: v.optional(v.number()) })) },
  handler: async (ctx, { id, idle }) => {
    const a = await ctx.db.get(id);
    if (!a) return null;
    // Keeps a wake request that landed mid-tick, so it still earns its check.
    await ctx.db.patch(id, { idle: idle === null ? undefined : { ...idle, ...(a.idle?.wakeRequestedAt !== undefined ? { wakeRequestedAt: a.idle.wakeRequestedAt } : {}) } });
    return null;
  },
});

/** Robinhood agents claim their own token's creator fees into the wallet (convex/launchRh.ts): when they last did. */
export const feesClaimedAt = internalQuery({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => (await ctx.db.get(id))?.feesClaimedAt ?? null,
});

export const markFeesClaimed = internalMutation({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { feesClaimedAt: Date.now() });
    return null;
  },
});

// ---------------- lease: one worker per agent wallet ----------------

export const acquire = internalMutation({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }): Promise<number | null> => {
    const a = await ctx.db.get(id);
    const now = Date.now();
    if (!a || (a.leaseUntil !== undefined && a.leaseUntil > now)) return null;
    const until = now + LEASE_MS;
    await ctx.db.patch(id, { leaseUntil: until });
    return until;
  },
});

/** Only clears a lease it still owns, so an action that outlived its lease cannot free someone else's. */
export const release = internalMutation({
  args: { id: v.id("launchAgents"), token: v.number() },
  handler: async (ctx, { id, token }) => {
    const a = await ctx.db.get(id);
    if (a?.leaseUntil === token) await ctx.db.patch(id, { leaseUntil: undefined });
    return null;
  },
});
