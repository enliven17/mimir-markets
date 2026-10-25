// Demo records never enter launchAgents, on-chain positions, copy jobs, fee accounting or live baskets.
import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { secretMatches } from "../lib/internal-secrets";
import { DemoCreateBody, DemoBasketBody } from "../lib/demo/input";
import { DEMO, demoReturn, initialDemoState, type DemoAgent, type DemoState, type DemoStake, type DemoFeed } from "../lib/demo/types";
import { demoEvent, settleDemoStake } from "../lib/demo/engine";
import { DEFAULT_MARKET_RULES } from "../lib/launch/markets";
import { SHOWCASE_AGENTS } from "../lib/demo/showcase";
import type { z } from "zod";

function allowed(secret: string) {
  if (process.env.DEMO_ENABLED !== "1" || !secretMatches("launch", secret)) throw new Error("Preview is unavailable.");
}
async function session(ctx: QueryCtx | MutationCtx, hash: string) {
  const s = await ctx.db.query("demoSessions").withIndex("by_hash", (q) => q.eq("hash", hash)).unique();
  if (!s || s.expiresAt <= Date.now()) throw new ConvexError({ code: "demo_session_expired" });
  return s;
}
export function publicAgent(a: Doc<"demoAgents">): DemoAgent {
  return { id: a._id, name: a.name, ticker: a.ticker, avatarSeed: a.avatarSeed, thesis: a.thesis, chain: a.chain,
    status: a.expiresAt <= Date.now() ? "expired" : a.status, createdAt: a.createdAt, expiresAt: a.expiresAt,
    nextTickAt: a.nextTickAt, trading: a.trading, markets: a.markets, state: a.state,
    ...(a.showcaseKey ? { showcaseKey: a.showcaseKey } : {}) };
}
async function insertAgent(ctx: MutationCtx, sessionId: Id<"demoSessions">, expiresAt: number, b: z.infer<typeof DemoCreateBody>, showcaseKey?: string) {
  const t = b.trading;
  return ctx.db.insert("demoAgents", {
    session: sessionId, name: b.name, ticker: b.ticker, avatarSeed: b.avatarSeed ?? b.ticker.toLowerCase(), thesis: b.thesis,
    chain: b.chain, status: "live", createdAt: Date.now(), expiresAt, nextTickAt: Date.now(), version: 0,
    trading: t.enabled ? { enabled: true, config: { ...t.strategy, trailingStopPct: t.trailingStopPct || null, maxHoldMinutes: t.maxHoldMinutes || null, thesis: b.thesis, liveView: "public", copyTrade: false }, risk: t.risk } : { enabled: false, config: null, risk: null },
    markets: { enabled: b.markets.enabled, budgetUsdc: b.markets.budgetUsdc, rules: { ...DEFAULT_MARKET_RULES, categories: b.markets.categories, minEdge: b.markets.minEdge, kellyFraction: b.markets.kellyFraction, maxStakeUsdc: b.markets.maxStakeUsdc, maxHoursToClose: b.markets.maxHoursToClose } },
    state: initialDemoState(Date.now()), ...(showcaseKey ? { showcaseKey } : {}),
  });
}
async function control(ctx: QueryCtx | MutationCtx, key: string) {
  return ctx.db.query("demoControl").withIndex("by_key", (q) => q.eq("key", key)).unique();
}
async function putControl(ctx: MutationCtx, key: string, value: unknown) {
  const row = await control(ctx, key);
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert("demoControl", { key, value });
}
async function consume(ctx: MutationCtx, key: string, limit: number, windowMs: number, now: number) {
  const row = await control(ctx, key);
  const window = Math.floor(now / windowMs);
  const hits = row?.value.window === window ? Number(row.value.hits) : 0;
  if (hits >= limit) return false;
  await putControl(ctx, key, { window, hits: hits + 1 });
  return true;
}

export const createSession = mutation({
  args: { secret: v.string(), hash: v.string(), owner: v.string() },
  handler: async (ctx, { secret, hash, owner }) => {
    allowed(secret);
    if (!/^[a-f0-9]{64}$/.test(hash) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) throw new Error("Invalid wallet session.");
    const existing = await ctx.db.query("demoSessions").withIndex("by_owner", (q) => q.eq("owner", owner)).unique();
    if (existing && existing.expiresAt > Date.now()) {
      if (existing.hash !== hash) await ctx.db.patch(existing._id, { hash });
      return { ok: true };
    }
    if (!await consume(ctx, "sessions-hour", 100, 3_600_000, Date.now())) return { error: "Preview is busy. Please try again later." };
    const value = { hash, owner, expiresAt: Date.now() + DEMO.sessionMs, agentsCreated: 0, basketsCreated: 0 };
    // Expired agents and baskets keep their original expiry/session until cleanup; use a fresh record.
    if (existing) await ctx.db.patch(existing._id, { owner: undefined, hash: `expired-${existing._id}` });
    await ctx.db.insert("demoSessions", value);
    return { ok: true };
  },
});

export const createAgent = mutation({
  args: { secret: v.string(), hash: v.string(), input: v.any() },
  handler: async (ctx, { secret, hash, input }) => {
    allowed(secret);
    const s = await session(ctx, hash);
    const b = DemoCreateBody.parse(input);
    if (s.agentsCreated >= DEMO.maxAgents) return { error: `Each preview session can create ${DEMO.maxAgents} agents.` };
    const active = await ctx.db.query("demoAgents").withIndex("by_expires", (q) => q.gt("expiresAt", Date.now())).take(DEMO.maxActiveAgents);
    if (active.length >= DEMO.maxActiveAgents) return { error: "Preview capacity reached. Please try again later." };
    if (!await consume(ctx, "agents-hour", 30, 3_600_000, Date.now())) return { error: "Preview is busy. Please try again later." };
    const id = await insertAgent(ctx, s._id, s.expiresAt, b);
    await ctx.db.patch(s._id, { agentsCreated: s.agentsCreated + 1 });
    return { id, used: s.agentsCreated + 1 };
  },
});

export const dashboard = query({
  args: { secret: v.string(), hash: v.string() },
  handler: async (ctx, { secret, hash }) => {
    allowed(secret);
    const s = await session(ctx, hash);
    const agents = (await ctx.db.query("demoAgents").withIndex("by_session", (q) => q.eq("session", s._id)).take(DEMO.maxAgents)).map(publicAgent);
    const stakes = (await Promise.all(agents.map((a) => ctx.db.query("demoStakes").withIndex("by_agent", (q) => q.eq("agentId", a.id)).take(500)))).flat().map(({ _id, _creationTime, ...a }) => ({ id: _id, ...a }));
    const baskets = (await ctx.db.query("demoBaskets").withIndex("by_session", (q) => q.eq("session", s._id)).take(DEMO.maxBaskets)).map((b) => {
      const values = b.members.map((m) => {
        const a = agents.find((a) => a.id === m.agentId)!;
        return 1 + demoReturn(a, stakes.filter((p) => p.agentId === a.id && p.status === "open").reduce((sum, p) => sum + p.amount, 0));
      });
      const totalReturn = b.members.reduce((sum, m, i) => sum + (values[i] / b.baseline[i] - 1) * m.weightBps / 10_000, 0);
      return { id: b._id, name: b.name, thesis: b.thesis, members: b.members, createdAt: b.createdAt, totalReturn, nav: 1_000 * (1 + totalReturn) };
    });
    return { expiresAt: s.expiresAt, agents, stakes, baskets };
  },
});

export const setStatus = mutation({
  args: { secret: v.string(), hash: v.string(), id: v.id("demoAgents"), status: v.union(v.literal("live"), v.literal("paused"), v.literal("killed")) },
  handler: async (ctx, { secret, hash, id, status }) => {
    allowed(secret);
    const s = await session(ctx, hash);
    const a = await ctx.db.get(id);
    if (!a || a.session !== s._id || a.status === "killed" || a.status === "expired") return { error: "Preview agent is unavailable." };
    const state: DemoState = JSON.parse(JSON.stringify(a.state));
    demoEvent(state, Date.now(), "rules", `${status === "live" ? "Resumed" : status === "paused" ? "Paused" : "Shut down"} by its owner.`);
    await ctx.db.patch(id, { status, state, nextTickAt: Date.now(), version: a.version + 1 });
    return { ok: true };
  },
});

export const createBasket = mutation({
  args: { secret: v.string(), hash: v.string(), input: v.any() },
  handler: async (ctx, { secret, hash, input }) => {
    allowed(secret);
    const s = await session(ctx, hash);
    const b = DemoBasketBody.parse(input);
    if (s.basketsCreated >= DEMO.maxBaskets) return { error: "Each preview session can create 3 baskets." };
    const baseline: number[] = [];
    for (const m of b.members) {
      const id = ctx.db.normalizeId("demoAgents", m.agentId);
      const a = id ? await ctx.db.get(id) : null;
      if (!a || a.session !== s._id) return { error: "Choose agents from your preview session." };
      const stakes = await ctx.db.query("demoStakes").withIndex("by_agent", (q) => q.eq("agentId", m.agentId)).take(500);
      const value = 1 + demoReturn(publicAgent(a), stakes.filter((p) => p.status === "open").reduce((sum, p) => sum + p.amount, 0));
      if (!(value > 0)) return { error: "An agent with no remaining virtual equity cannot join a new basket." };
      baseline.push(value);
    }
    const id = await ctx.db.insert("demoBaskets", { session: s._id, ...b, baseline, createdAt: Date.now() });
    await ctx.db.patch(s._id, { basketsCreated: s.basketsCreated + 1 });
    return { id };
  },
});

/** Bounded, public paper activity. No session identifiers or credentials leave this query. */
export const marketActivity = query({
  args: { kind: v.union(v.literal("pool"), v.literal("vs")), marketId: v.number() },
  handler: async (ctx, { kind, marketId }) => {
    if (process.env.DEMO_ENABLED !== "1" || kind !== "pool") return [];
    return (await ctx.db.query("demoStakes").withIndex("by_market", (q) => q.eq("kind", "pool").eq("marketId", marketId)).order("desc").take(30))
      .map(({ agentName, agentSeed, side, label, amount, why, at, status, payout, _id }) => ({ id: _id, agentName, agentSeed, side, label, amount, why, at, status, payout }));
  },
});

/** Public house examples: safe to browse without a wallet or a guest session. */
export const showcase = query({
  args: {}, handler: async (ctx) => {
    if (process.env.DEMO_ENABLED !== "1") return { agents: [], stakes: [] };
    const rows = await Promise.all(SHOWCASE_AGENTS.map(({ key }) => ctx.db.query("demoAgents").withIndex("by_showcase", (q) => q.eq("showcaseKey", key)).unique()));
    const agents = rows.filter((a): a is Doc<"demoAgents"> => a !== null).map(publicAgent);
    const stakes = (await Promise.all(agents.map((a) => ctx.db.query("demoStakes").withIndex("by_agent", (q) => q.eq("agentId", a.id)).take(100)))).flat()
      .map(({ _id, _creationTime, ...s }) => ({ id: _id, ...s }));
    return { agents, stakes };
  },
});

/** Idempotent house seeding; automatic on the first enabled worker tick. No real launch or guest quota. */
export const ensureShowcase = internalMutation({
  args: {}, handler: async (ctx) => {
    if (process.env.DEMO_ENABLED !== "1" || process.env.MIMIR_BACKEND_OFF === "1") return;
    const expiresAt = Date.now() + DEMO.sessionMs;
    let s = await ctx.db.query("demoSessions").withIndex("by_hash", (q) => q.eq("hash", "mimir-showcase")).unique();
    if (!s) {
      const id = await ctx.db.insert("demoSessions", { hash: "mimir-showcase", expiresAt, agentsCreated: 5, basketsCreated: 0 });
      s = (await ctx.db.get(id))!;
    }
    if (s.expiresAt - Date.now() < 2 * 86_400_000) await ctx.db.patch(s._id, { expiresAt });
    for (const { key, input } of SHOWCASE_AGENTS) {
      const a = await ctx.db.query("demoAgents").withIndex("by_showcase", (q) => q.eq("showcaseKey", key)).unique();
      if (!a) await insertAgent(ctx, s._id, expiresAt, input, key);
      else if (a.expiresAt - Date.now() < 2 * 86_400_000) await ctx.db.patch(a._id, { expiresAt,
        ...(a.status === "expired" ? { status: "live" as const, nextTickAt: Date.now(), version: a.version + 1 } : {}) });
      // House agents have no private owner to press Resume after a daily risk pause.
      if (a?.status === "paused" && (a.state as DemoState).day < Math.floor(Date.now() / 86_400_000)) await ctx.db.patch(a._id, { status: "live", nextTickAt: Date.now(), version: a.version + 1 });
    }
  },
});

// A lease plus a version check prevents overlapping ticks or an owner pause from overwriting a newer state.
export const claimTick = internalMutation({
  args: {}, handler: async (ctx) => {
    if (process.env.MIMIR_BACKEND_OFF === "1" || process.env.DEMO_ENABLED !== "1") return [];
    const now = Date.now();
    const rows = await ctx.db.query("demoAgents").withIndex("by_due", (q) => q.lte("nextTickAt", now)).take(10);
    const result: Array<{ agent: DemoAgent; version: number; stakes: DemoStake[] }> = [];
    for (const a of rows) {
      if (a.expiresAt <= now) { await ctx.db.patch(a._id, { status: "expired", nextTickAt: Number.MAX_SAFE_INTEGER }); continue; }
      const stakes = await ctx.db.query("demoStakes").withIndex("by_agent", (q) => q.eq("agentId", a._id)).take(500);
      const state: DemoState = JSON.parse(JSON.stringify(a.state));
      for (const p of stakes.filter((p) => p.status === "open")) {
        const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", "pool").eq("marketId", p.marketId)).unique();
        const settled = m ? settleDemoStake({ id: p._id, ...p }, m) : null;
        if (!settled) continue;
        await ctx.db.patch(p._id, settled);
        state.usdc += settled.payout;
        state.marketPnl += settled.payout - p.amount;
        Object.assign(p, settled);
        demoEvent(state, now, "settlement", `Preview market #${p.marketId}: ${settled.status}, ${settled.payout.toFixed(2)} virtual USDC returned.`);
      }
      const nextTickAt = a.status === "killed" && !state.positions.length && !stakes.some((p) => p.status === "open") ? Number.MAX_SAFE_INTEGER : now + DEMO.tickMs;
      const version = a.version + 1;
      await ctx.db.patch(a._id, { state, nextTickAt, version });
      result.push({ agent: publicAgent({ ...a, state, nextTickAt }), version, stakes: stakes.map(({ _id, _creationTime, ...p }) => ({ id: _id, ...p })) });
    }
    return result;
  },
});

export const claimAi = internalMutation({
  args: { id: v.id("demoAgents"), version: v.number() }, handler: async (ctx, { id, version }) => {
    if (process.env.DEMO_ENABLED !== "1" || process.env.MIMIR_BACKEND_OFF === "1") return false;
    const a = await ctx.db.get(id);
    const now = Date.now(), day = Math.floor(now / 86_400_000);
    if (!a || a.version !== version || a.status !== "live" || a.expiresAt <= now) return false;
    const calls = a.aiDay === day ? (a.aiCalls ?? 0) : 0;
    if (calls >= DEMO.agentAiCallsPerDay) return false;
    const hour = await control(ctx, "ai-hour"), daily = await control(ctx, "ai-day");
    const h = hour?.value.window === Math.floor(now / 3_600_000) ? Number(hour.value.hits) : 0;
    const d = daily?.value.window === day ? Number(daily.value.hits) : 0;
    if (h >= DEMO.aiCallsPerHour || d >= DEMO.aiCallsPerDay) return false;
    if (a.showcaseKey) {
      const showcaseHour = await control(ctx, "showcase-ai-hour"), showcaseDay = await control(ctx, "showcase-ai-day");
      const sh = showcaseHour?.value.window === Math.floor(now / 3_600_000) ? Number(showcaseHour.value.hits) : 0;
      const sd = showcaseDay?.value.window === day ? Number(showcaseDay.value.hits) : 0;
      if (sh >= DEMO.showcaseAiCallsPerHour || sd >= DEMO.showcaseAiCallsPerDay) return false;
      await putControl(ctx, "showcase-ai-hour", { window: Math.floor(now / 3_600_000), hits: sh + 1 });
      await putControl(ctx, "showcase-ai-day", { window: day, hits: sd + 1 });
    }
    await putControl(ctx, "ai-hour", { window: Math.floor(now / 3_600_000), hits: h + 1 });
    await putControl(ctx, "ai-day", { window: day, hits: d + 1 });
    await ctx.db.patch(id, { aiDay: day, aiCalls: calls + 1 });
    return true;
  },
});

export const finishTick = internalMutation({
  args: { id: v.id("demoAgents"), version: v.number(), state: v.any(), pause: v.boolean(), stake: v.any() },
  handler: async (ctx, { id, version, state, pause, stake }) => {
    const a = await ctx.db.get(id);
    if (!a || a.version !== version || a.expiresAt <= Date.now() || process.env.DEMO_ENABLED !== "1" || process.env.MIMIR_BACKEND_OFF === "1") return;
    if (stake) await ctx.db.insert("demoStakes", stake);
    await ctx.db.patch(id, { state, ...(pause && a.status === "live" ? { status: "paused" as const } : {}), version: version + 1 });
  },
});

/** A durable shared snapshot; across action instances only one refresh may use the external feeds. */
export const feed = internalMutation({
  args: {}, handler: async (ctx): Promise<{ snapshot: DemoFeed | null; refresh: boolean; token: number; held: string[]; solana: boolean; robinhood: boolean }> => {
    const row = await control(ctx, "feed");
    const now = Date.now();
    const snapshot: DemoFeed | null = row?.value.snapshot ?? null;
    if ((snapshot && now - snapshot.at < DEMO.tickMs) || (row?.value.leaseUntil ?? 0) > now) return { snapshot, refresh: false, token: 0, held: [], solana: false, robinhood: false };
    const token = now;
    await putControl(ctx, "feed", { snapshot, leaseUntil: now + 60_000, token });
    const agents = await ctx.db.query("demoAgents").withIndex("by_expires", (q) => q.gt("expiresAt", now)).take(DEMO.maxActiveAgents);
    const held = [...new Set(agents.filter((a) => a.chain === "solana").flatMap((a) => (a.state as DemoState).positions.map((p) => p.mint)))];
    return { snapshot, refresh: true, token, held,
      solana: agents.some((a) => a.chain === "solana" && a.trading.enabled),
      robinhood: agents.some((a) => a.chain === "robinhood" && a.trading.enabled) };
  },
});
export const saveFeed = internalMutation({
  args: { token: v.number(), snapshot: v.any() }, handler: async (ctx, { token, snapshot }) => {
    const row = await control(ctx, "feed");
    if (row?.value.token === token) await putControl(ctx, "feed", { snapshot, leaseUntil: 0, token });
  },
});

/** Delete an expired session and all of its paper records after a one-day retention period. */
export const sweep = internalMutation({
  args: {}, handler: async (ctx) => {
    if (process.env.MIMIR_BACKEND_OFF === "1") return;
    const sessions = await ctx.db.query("demoSessions").withIndex("by_expires", (q) => q.lt("expiresAt", Date.now() - 86_400_000)).take(20);
    for (const s of sessions) {
      const agents = await ctx.db.query("demoAgents").withIndex("by_session", (q) => q.eq("session", s._id)).take(s.hash === "mimir-showcase" ? SHOWCASE_AGENTS.length : DEMO.maxAgents);
      for (const a of agents) {
        const stakes = await ctx.db.query("demoStakes").withIndex("by_agent", (q) => q.eq("agentId", a._id)).take(500);
        for (const p of stakes) await ctx.db.delete(p._id);
        await ctx.db.delete(a._id);
      }
      const baskets = await ctx.db.query("demoBaskets").withIndex("by_session", (q) => q.eq("session", s._id)).take(DEMO.maxBaskets);
      for (const b of baskets) await ctx.db.delete(b._id);
      await ctx.db.delete(s._id);
    }
  },
});
