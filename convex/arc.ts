import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import schema, { status, vChain } from "./schema";
import { orderDecisions, retryDelayMs } from "../lib/oracle-queue";
import { houseCreatorWallet } from "../lib/chains/house";
import { pairWaits } from "../lib/chains/linked";

// The market index of every chain (convex/arcSync.ts writes it). Every market is keyed (chain, kind, marketId); public
// queries take `chain` optionally and default to "arc", so links and clients from before Base keep working.
const kind = v.union(v.literal("vs"), v.literal("pool"));
type Chain = "arc" | "base";
const chainArg = v.optional(vChain);
/** A row without a chain is Arc's (written before Base). */
const chainOf = (r: { chain?: Chain }): Chain => r.chain ?? "arc";

export const cursor = internalQuery({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) =>
    (await ctx.db.query("arcCursor").withIndex("by_name", (q) => q.eq("name", name ?? "arc")).unique())?.block ?? null,
});

/** Record a link (lib/chains/linked.ts) for a market an agent just opened, and stamp the market row if indexed already. */
export const link = internalMutation({
  args: { pairKey: v.string(), chain: vChain, kind, marketId: v.number() },
  handler: async (ctx, a) => {
    const seen = await ctx.db.query("marketLinks").withIndex("by_market", (q) => q.eq("chain", a.chain).eq("kind", a.kind).eq("marketId", a.marketId)).unique();
    if (!seen) await ctx.db.insert("marketLinks", { ...a, at: Date.now() });
    const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("chain", a.chain).eq("kind", a.kind).eq("marketId", a.marketId)).unique();
    if (m && m.pairKey !== a.pairKey) await ctx.db.patch(m._id, { pairKey: a.pairKey });
  },
});

/** The same market on the other chains (its link siblings), public fields only. */
async function siblingsOf(ctx: QueryCtx, m: Doc<"arcMarkets">) {
  if (!m.pairKey) return [];
  const rows = await ctx.db.query("arcMarkets").withIndex("by_pair", (q) => q.eq("pairKey", m.pairKey)).take(10);
  return rows
    .filter((r) => r._id !== m._id && !r.isPrivate)
    .map((r) => ({ chain: chainOf(r), kind: r.kind, marketId: r.marketId, status: r.status, stakeA: r.stakeA, stakeB: r.stakeB, volumeUsd: r.volumeUsd, participants: r.participants, deadline: r.deadline, lockAt: r.lockAt }));
}

/** One indexed block range, all or nothing: snapshots, positions, events and the cursor move together. */
export const apply = internalMutation({
  args: {
    name: v.string(),
    block: v.number(),
    markets: v.array(schema.tables.arcMarkets.validator),
    positions: v.array(schema.tables.arcPositions.validator),
    events: v.array(schema.tables.arcEvents.validator),
  },
  handler: async (ctx, { name, block, markets, positions, events }) => {
    // What changed, for Telegram (arcSync posts these to /api/telegram/arc-events).
    const changes: Array<{ type: "new" | "proposed" | "resolved" | "cancelled"; chain: Chain; kind: "vs" | "pool"; marketId: number }> = [];
    for (const p of positions) {
      const row = await ctx.db
        .query("arcPositions")
        .withIndex("by_position", (q) => q.eq("chain", p.chain).eq("kind", p.kind).eq("marketId", p.marketId).eq("user", p.user).eq("side", p.side))
        .unique();
      if (row) await ctx.db.patch(row._id, { amount: p.amount, amountUsd: p.amountUsd });
      else await ctx.db.insert("arcPositions", p);
    }
    for (const m of markets) {
      const c = chainOf(m);
      const row = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", m.kind).eq("marketId", m.marketId)).unique();
      // Overlapping runs: never let an older snapshot overwrite a newer one.
      if (row && row.updatedBlock > m.updatedBlock) continue;
      if (!row) changes.push({ type: "new", chain: c, kind: m.kind, marketId: m.marketId });
      else if (row.status !== m.status && (m.status === "proposed" || m.status === "resolved" || m.status === "cancelled")) {
        changes.push({ type: m.status, chain: c, kind: m.kind, marketId: m.marketId });
      }
      const participants = m.kind === "pool"
        ? new Set((await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", "pool").eq("marketId", m.marketId)).collect()).map((p) => p.user)).size
        : m.participants;
      // A link recorded when the agent opened it (arc.link) carries over; the snapshot itself never knows it.
      const pairKey = row?.pairKey ?? (await ctx.db.query("marketLinks").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", m.kind).eq("marketId", m.marketId)).unique())?.pairKey;
      const next = { ...m, chain: c, participants, ...(pairKey ? { pairKey } : {}) };
      if (row) await ctx.db.replace(row._id, next);
      else await ctx.db.insert("arcMarkets", next);
      if (!m.isPrivate && (!row || row.status !== m.status)) await ctx.db.insert("discoverySignals", { marketChain: c, marketKind: m.kind, marketId: m.marketId, category: m.category,
        type: row ? "settlement" : "new_market", text: `${row ? `Market is ${m.status}` : "New market"}: ${m.question}`, at: Date.now() });
    }
    for (const e of events) {
      const seen = await ctx.db.query("arcEvents").withIndex("by_log", (q) => q.eq("txHash", e.txHash).eq("logIndex", e.logIndex)).first();
      if (seen && chainOf(seen) === chainOf(e)) continue;
      await ctx.db.insert("arcEvents", { ...e, chain: chainOf(e) });
      // A pool payout collected (by the user or pushed by the oracle): mark that user's legs paid.
      if (e.kind === "pool" && e.name === "Claimed" && e.user) {
        const legs = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("chain", chainOf(e)).eq("kind", "pool").eq("marketId", e.marketId)).collect();
        for (const p of legs) if (p.user === e.user) await ctx.db.patch(p._id, { claimed: true });
      }
    }
    const c = await ctx.db.query("arcCursor").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (!c) await ctx.db.insert("arcCursor", { name, block });
    else if (block > c.block) await ctx.db.patch(c._id, { block });
    return changes;
  },
});

/** Public markets, newest first; optionally one chain, one kind and/or one status. */
export const markets = query({
  args: { chain: chainArg, kind: v.optional(kind), status: v.optional(status), limit: v.optional(v.number()) },
  handler: async (ctx, { chain, kind, status, limit }) => {
    const n = Math.min(limit ?? 100, 500);
    // Bounded reads: by state (newest deadline first) when one is asked for, else the newest markets.
    const rows = status
      ? await ctx.db.query("arcMarkets").withIndex("by_status_deadline", (q) => q.eq("status", status)).order("desc").take(n * 4)
      : await ctx.db.query("arcMarkets").order("desc").take(n * 4);
    return rows
      .filter((m) => !m.isPrivate && (!kind || m.kind === kind) && (!chain || chainOf(m) === chain))
      .slice(0, n)
      .map((m) => ({ ...m, chain: chainOf(m) }));
  },
});

export const market = query({
  args: { chain: chainArg, kind, marketId: v.number() },
  handler: async (ctx, { chain: c = "arc", kind, marketId }) => {
    const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", kind).eq("marketId", marketId)).unique();
    if (!m) return null;
    const [positions, events] = await Promise.all([
      ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", kind).eq("marketId", marketId)).collect(),
      ctx.db.query("arcEvents").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", kind).eq("marketId", marketId)).collect(),
    ]);
    // Every transaction on the market, newest first (chain order, not insertion order).
    events.sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
    const verdict = await ctx.db.query("arcVerdicts").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", kind).eq("marketId", marketId)).order("desc").first();
    // Fees this market paid, from its FeeAccrued events: entry fees and copy-trade fees, all on chain.
    const feesCollected = events.filter((e) => e.name === "FeeAccrued").reduce((sum, e) => sum + BigInt(e.amount ?? "0"), 0n).toString();
    return { ...m, chain: c, positions, events, verdict, feesCollected, linked: await siblingsOf(ctx, m) };
  },
});

/** Everything one account holds, on every chain, with its market (an EOA is the same address on Base and Arc). */
export const positionsOf = query({
  args: { user: v.string() },
  handler: async (ctx, { user }) => {
    const rows = await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", user.toLowerCase())).order("desc").take(500);
    return Promise.all(
      rows.map(async (p) => ({
        ...p,
        chain: chainOf(p),
        market: await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("chain", chainOf(p)).eq("kind", p.kind).eq("marketId", p.marketId)).unique(),
      })),
    );
  },
});

/**
 * Run the indexer now instead of waiting for the next cron tick: the app calls
 * this right after a create or stake lands, so the page catches up in seconds.
 */
// Public (the browser calls it), so debounced: at most one extra indexer run per POKE_GAP_MS for everyone together.
const POKE_GAP_MS = 5_000;
export const poke = mutation({
  args: { chain: chainArg },
  handler: async (ctx, { chain: c = "arc" }) => {
    const now = Date.now();
    const name = `${c}-poke`;
    const last = await ctx.db.query("arcHeartbeats").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (last && now - last.at < POKE_GAP_MS) return;
    if (last) await ctx.db.patch(last._id, { at: now });
    else await ctx.db.insert("arcHeartbeats", { name, at: now });
    await ctx.scheduler.runAfter(0, internal.arcSync.sync, { chain: c });
  },
});

// ── Oracle bookkeeping (convex/arcOracle.ts) ────────────────────────────────

/** How many decisions one oracle tick is offered (arcOracle takes the first few), and how far each scan reads. */
const DECIDE_BATCH = 12;
const SCAN = 400;
const SPAM_UNCONTESTED_PER_CREATOR = 3;

/** Everything the oracle may do right now on one chain, from the index. `now` in unix seconds. Every read is bounded. */
export const oracleWork = internalQuery({
  args: { chain: vChain, now: v.number() },
  handler: async (ctx, { chain: c, now }) => {
    type M = Doc<"arcMarkets">;
    // Past their deadline, by state: VS needs a challenger to be decided ("active"); a pool is decided once open.
    const due = async (st: M["status"]) =>
      (await ctx.db.query("arcMarkets").withIndex("by_status_deadline", (q) => q.eq("status", st).lte("deadline", now)).take(SCAN)).filter((m) => chainOf(m) === c);
    const [active, open, proposed, disputed] = await Promise.all([due("active"), due("open"), due("proposed"), due("disputed")]);
    const undecided = [...active.filter((m) => m.kind === "vs"), ...open.filter((m) => m.kind === "pool")];

    // Spam guard: a creator with more than SPAM_UNCONTESTED_PER_CREATOR one-sided markets due at once gets no oracle
    // gas spent on the extra ones; they stay refundable by anyone (refundExpired) once the grace period ends.
    // The house creator's own pools are exempt: their stake is ours and it should come back.
    const oneSided = (m: M) => BigInt(m.stakeA) === 0n || BigInt(m.stakeB) === 0n;
    const house = houseCreatorWallet(c)?.address ?? null;
    const seen = new Map<string, number>();
    const spam = new Set<M["_id"]>();
    for (const m of [...undecided].sort((a, b) => a.createdAt - b.createdAt)) {
      if (!oneSided(m) || m.creator === house) continue;
      const n = (seen.get(m.creator) ?? 0) + 1;
      seen.set(m.creator, n);
      if (n > SPAM_UNCONTESTED_PER_CREATOR) spam.add(m._id);
    }

    const ready: M[] = [];
    for (const m of undecided) {
      if (spam.has(m._id)) continue;
      if (m.refundAt <= now) continue;
      const t = await ctx.db.query("arcOracleTries").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", m.kind).eq("marketId", m.marketId)).unique();
      if (t && t.notBefore > now * 1000) continue;
      // A linked market shares its pair's backoff: while another leg's decision is deferred, this leg waits too, so
      // the pair is decided once instead of once per chain. Once the pair has a decision, reusing it costs nothing.
      if (m.pairKey) {
        const decided = Boolean(await ctx.db.query("arcPairDecisions").withIndex("by_pair", (q) => q.eq("pairKey", m.pairKey!)).first());
        const legs = decided ? [] : (await ctx.db.query("arcMarkets").withIndex("by_pair", (q) => q.eq("pairKey", m.pairKey)).take(10)).filter((r) => chainOf(r) !== c);
        const retryAt: number[] = [];
        for (const leg of legs) {
          const lt = await ctx.db.query("arcOracleTries").withIndex("by_market", (q) => q.eq("chain", chainOf(leg)).eq("kind", leg.kind).eq("marketId", leg.marketId)).unique();
          if (lt) retryAt.push(lt.notBefore);
        }
        if (pairWaits(retryAt, now * 1000, decided)) continue;
      }
      ready.push(m);
    }
    const decide = orderDecisions(
      ready.map((m) => ({ ...m, pot: BigInt(m.stakeA) + BigInt(m.stakeB) })),
      DECIDE_BATCH,
      now,
    ).map(({ pot: _pot, ...m }) => m as M);

    const finalize = proposed.filter((m) => m.disputableUntil > 0 && m.disputableUntil <= now);
    const refund = [...undecided.filter((m) => !spam.has(m._id)), ...disputed].filter((m) => m.refundAt <= now).slice(0, 50);

    // Pool payouts still owed: settled in the last 30 days (older ones anyone can claim themselves).
    const since = now - 30 * 86_400;
    const settledPools = async (st: M["status"]) =>
      (await ctx.db.query("arcMarkets").withIndex("by_status_deadline", (q) => q.eq("status", st).gte("deadline", since)).order("desc").take(400)).filter(
        (m) => m.kind === "pool" && chainOf(m) === c,
      );
    const pay: Array<{ marketId: number; users: string[] }> = [];
    for (const m of [...(await settledPools("resolved")), ...(await settledPools("cancelled"))]) {
      const contested = BigInt(m.stakeA) > 0n && BigInt(m.stakeB) > 0n;
      const legs = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", "pool").eq("marketId", m.marketId)).take(500);
      // Winners only on a contested A/B outcome (losers have nothing to claim); everyone on a refund.
      const owed = legs.filter((p) => !p.claimed && (!contested || (m.winner !== 1 && m.winner !== 2) || p.side === m.winner));
      const users = [...new Set(owed.map((p) => p.user))];
      if (users.length) pay.push({ marketId: m.marketId, users });
      if (pay.length >= 50) break;
    }
    const pick = ({ kind, marketId }: { kind: "vs" | "pool"; marketId: number }) => ({ chain: c, kind, marketId });
    return { decide, finalize: finalize.slice(0, 50).map(pick), refund: refund.map(pick), pay };
  },
});

/** A deferred or failed decision: try this market again later, backing off exponentially (lib/oracle-queue.ts), at most `capMinutes` apart. */
export const deferMarket = internalMutation({
  args: { chain: vChain, kind, marketId: v.number(), error: v.optional(v.string()), capMinutes: v.optional(v.number()) },
  handler: async (ctx, { chain: c, kind, marketId, error, capMinutes }) => {
    const row = await ctx.db.query("arcOracleTries").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", kind).eq("marketId", marketId)).unique();
    const attempts = (row?.attempts ?? 0) + 1;
    const next = { notBefore: Date.now() + retryDelayMs(attempts, capMinutes), lastError: error?.slice(0, 500) };
    if (row) await ctx.db.patch(row._id, { ...next, attempts });
    else await ctx.db.insert("arcOracleTries", { chain: c, kind, marketId, attempts, ...next });
  },
});

export const saveVerdict = internalMutation({
  args: schema.tables.arcVerdicts.validator,
  handler: async (ctx, verdict) => {
    const c = chainOf(verdict);
    await ctx.db.insert("arcVerdicts", { ...verdict, chain: c });
    // Decided: its retry row is done, so the watchdog stops counting it.
    const tries = await ctx.db.query("arcOracleTries").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", verdict.kind).eq("marketId", verdict.marketId)).unique();
    if (tries) await ctx.db.delete(tries._id);
  },
});

/**
 * Decisions already made for a link (lib/chains/linked.ts): the pair's stored decision first (stored: true), then the
 * verdicts proposed on its legs, oldest first. The oracle reuses one (siblingDecision).
 */
export const linkedVerdicts = internalQuery({
  args: { pairKey: v.string() },
  handler: async (ctx, { pairKey }) => {
    const stored = (await ctx.db.query("arcPairDecisions").withIndex("by_pair", (q) => q.eq("pairKey", pairKey)).take(5)).map((r) => ({
      chain: r.chain, side: r.side, decided: r.side, confidence: r.confidence, summary: r.summary, evidenceHash: r.evidenceHash, bundle: r.bundle, stored: true as const,
    }));
    const proposed = (await ctx.db.query("arcVerdicts").withIndex("by_pair", (q) => q.eq("pairKey", pairKey)).take(20)).map((r) => ({
      chain: chainOf(r), side: r.side, decided: r.decided, confidence: r.confidence, summary: r.summary, decidedSummary: r.decidedSummary, evidenceHash: r.evidenceHash, bundle: r.bundle,
    }));
    return [...stored, ...proposed];
  },
});

/**
 * Store the pair's decision, right after the model decided and before any leg proposes it. The first one stands:
 * a concurrent second decision is dropped, and the caller proposes the stored one (returned) instead.
 */
export const savePairDecision = internalMutation({
  args: { pairKey: v.string(), chain: vChain, kind, marketId: v.number(), side: v.number(), confidence: v.number(), summary: v.string(), evidenceHash: v.string(), bundle: v.string() },
  handler: async (ctx, d) => {
    const prev = await ctx.db.query("arcPairDecisions").withIndex("by_pair", (q) => q.eq("pairKey", d.pairKey)).first();
    if (prev) return { chain: prev.chain, side: prev.side, confidence: prev.confidence, summary: prev.summary, evidenceHash: prev.evidenceHash, bundle: prev.bundle, fresh: false };
    await ctx.db.insert("arcPairDecisions", { ...d, at: Date.now() });
    return { ...d, fresh: true };
  },
});

/**
 * Whether any of `house` (lowercase operator addresses) opened or holds a position on ANY leg of a link: then the one
 * decision for the pair is held to the house bar (firm verdicts only, agents/oracle/decide.ts), whichever leg decides.
 */
export const pairHouseHeld = internalQuery({
  args: { pairKey: v.string(), house: v.array(v.string()) },
  handler: async (ctx, { pairKey, house }) => {
    const ours = new Set(house.map((a) => a.toLowerCase()));
    for (const leg of await ctx.db.query("arcMarkets").withIndex("by_pair", (q) => q.eq("pairKey", pairKey)).take(10)) {
      if (ours.has(leg.creator)) return true;
      const legs = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("chain", chainOf(leg)).eq("kind", leg.kind).eq("marketId", leg.marketId)).take(500);
      if (legs.some((p) => ours.has(p.user))) return true;
    }
    return false;
  },
});

/** The oracle's audit bundle for a market: what anyone can hash to check the on-chain evidenceHash. */
export const verdict = query({
  args: { chain: chainArg, kind, marketId: v.number() },
  handler: async (ctx, { chain: c = "arc", kind, marketId }) =>
    (await ctx.db.query("arcVerdicts").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", kind).eq("marketId", marketId)).order("desc").first()) ?? null,
});

export const marketWithPositions = internalQuery({
  args: { chain: chainArg, kind, marketId: v.number() },
  handler: async (ctx, { chain: c = "arc", kind, marketId }) => {
    const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", kind).eq("marketId", marketId)).unique();
    if (!m) return null;
    const positions = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", kind).eq("marketId", marketId)).collect();
    return { ...m, chain: c, positions };
  },
});

/** When each stake on a market landed (the opening stake included), for the late-stake rule (lib/late-stakes.ts). */
const STAKE_EVENTS = new Set(["ClaimCreated", "ClaimChallenged", "MarketCreated", "Staked"]);
export const stakeTimes = internalQuery({
  args: { chain: chainArg, kind, marketId: v.number() },
  handler: async (ctx, { chain: c = "arc", kind, marketId }) =>
    (await ctx.db.query("arcEvents").withIndex("by_market", (q) => q.eq("chain", c).eq("kind", kind).eq("marketId", marketId)).take(2000))
      .filter((e) => STAKE_EVENTS.has(e.name) && e.at !== undefined)
      .map((e) => ({ at: e.at as number, user: e.user })),
});

/** Markets still taking positions after `closesAfter` (unix seconds): VS open or active, pools open; one chain or all. */
export const openMarkets = internalQuery({
  args: { closesAfter: v.number(), chain: chainArg },
  handler: async (ctx, { closesAfter, chain: c }) =>
    // Bounded: the next 2000 markets by deadline.
    (await ctx.db.query("arcMarkets").withIndex("by_deadline", (q) => q.gt("deadline", closesAfter)).take(2000))
      .filter((m) => !m.isPrivate && (m.status === "open" || m.status === "active") && (!c || chainOf(m) === c))
      .map((m) => ({ ...m, chain: chainOf(m) })),
});

/** Every market one address opened (lowercase), any status. */
/** How many markets an account opened in the last 24 hours (the create form's daily limit). */
export const openedToday = query({
  args: { creator: v.string() },
  handler: async (ctx, { creator }) => {
    const since = Math.floor(Date.now() / 1000) - 86_400;
    const rows = await ctx.db.query("arcMarkets").withIndex("by_creator", (q) => q.eq("creator", creator.toLowerCase())).order("desc").take(50);
    return rows.filter((m) => m.createdAt >= since).length;
  },
});

/** Every market one address opened (lowercase), on one chain or all, newest first. */
export const marketsBy = internalQuery({
  args: { creator: v.string(), chain: chainArg },
  handler: async (ctx, { creator, chain: c }) =>
    (await ctx.db.query("arcMarkets").withIndex("by_creator", (q) => q.eq("creator", creator.toLowerCase())).order("desc").take(2000))
      .filter((m) => !c || chainOf(m) === c)
      .map((m) => ({ ...m, chain: chainOf(m) })),
});
