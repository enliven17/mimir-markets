// Mimir Launch: creator-fee and holder-airdrop persistence (lib/launch/fees.ts FeeStore, lib/launch/airdrop.ts
// AirdropStore), ported from snipad convex/worker/{feeStore,airdropStore,schedule}.ts + convex/lib/allocation.ts.
// Claims, burns and payouts are idempotent on their signatures; a payout or treasury transfer stores its sig before
// broadcast. The cron entry points are cheap mutations that fan out one Node action per agent only when due.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type DatabaseReader, type DatabaseWriter } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { vAllocation } from "./schema";
import { secretMatches } from "../lib/internal-secrets";
import { ALLOCATION_DELAY_MS, allocationProblem, BUCKETS, effectiveAllocation, type Allocation, type AllocationState } from "../lib/launch/fees";
import { airdropDue, airdropSettings, FINAL_ROUND_MIN_LAMPORTS, type RoundView } from "../lib/launch/airdrop";
import type { Unresolved } from "../lib/launch/reconcile";

type Agent = Doc<"launchAgents">;
type AgentId = Id<"launchAgents">;
const vAgent = v.id("launchAgents");

const gated = () => process.env.MIMIR_BACKEND_OFF === "1" || process.env.LAUNCH_FEES !== "1";
/** Launched (a mint), with a Solana wallet, not pending. */
const feeable = (a: Agent): a is Agent & { mint: string; solana: { walletId: string; address: string }; status: "live" | "paused" | "killed" } => !!a.mint && !!a.solana && a.status !== "pending";

const log = (db: DatabaseWriter, agent: AgentId, kind: string, text: string) => db.insert("launchEvents", { agent, at: Date.now(), kind, text: text.slice(0, 300) });

// ---------------- allocation ----------------

export const allocationState = (a: Agent): AllocationState => ({
  allocation: a.allocation ?? null,
  pendingAllocation: a.pendingAllocation ? { allocation: a.pendingAllocation.allocation, effectiveAt: a.pendingAllocation.effectiveAt } : null,
});
export const allocationOf = (a: Agent, now = Date.now()): Allocation => effectiveAllocation(allocationState(a), now);

/** Folds a due pending change into `allocation`. Returns the fresh row. */
async function applyDue(db: DatabaseWriter, a: Agent, now = Date.now()): Promise<Agent> {
  const p = a.pendingAllocation;
  if (!p || p.effectiveAt > now) return a;
  await db.patch(a._id, { allocation: p.allocation, pendingAllocation: undefined });
  return { ...a, allocation: p.allocation, pendingAllocation: undefined };
}

/**
 * The owner changes where the agent's fees go: public at once, in force 24 hours later. A newer change replaces a
 * pending one and restarts the 24 hours. Served by /api/launch/:id/allocation (signed by the owner).
 */
export const requestAllocation = mutation({
  args: { secret: v.string(), slug: v.string(), owner: v.string(), allocation: vAllocation },
  handler: async (ctx, { secret, slug, owner, allocation }): Promise<{ ok: true; effectiveAt: number | null } | { ok: false; error: string }> => {
    if (!secretMatches("launch", secret)) throw new Error("not allowed");
    const found = await ctx.db.query("launchAgents").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!found || found.owner !== owner) return { ok: false, error: "Only the owner can change where the fees go." };
    if (found.status === "killed") return { ok: false, error: "This agent is shut down; its split is frozen." };
    const problem = allocationProblem(allocation);
    if (problem) return { ok: false, error: `Split refused: ${problem}.` };
    const now = Date.now();
    const a = await applyDue(ctx.db, found, now);
    const current = allocationOf(a, now);
    if (a.pendingAllocation) await ctx.db.patch(a._id, { pendingAllocation: undefined });
    if (BUCKETS.every((b) => current[b] === allocation[b])) return { ok: true, effectiveAt: null };
    const effectiveAt = now + ALLOCATION_DELAY_MS;
    await ctx.db.patch(a._id, { pendingAllocation: { allocation, effectiveAt, requestedAt: now } });
    await log(ctx.db, a._id, "fee", `fee split change asked for, applies ${new Date(effectiveAt).toISOString().slice(0, 16).replace("T", " ")} UTC`);
    return { ok: true, effectiveAt };
  },
});

/** "Where its fees go" on the agent page: public (the split, a pending change, what was claimed, burned, paid). */
export const feesView = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const a = await ctx.db.query("launchAgents").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!a || a.status === "pending") return null;
    const now = Date.now();
    const pending = a.pendingAllocation && a.pendingAllocation.effectiveAt > now ? { allocation: a.pendingAllocation.allocation, effectiveAt: a.pendingAllocation.effectiveAt } : null;
    // ponytail: totals scan the last 500 rows each; keep running totals on the agent once histories get long.
    const claims = await ctx.db.query("launchFeeClaims").withIndex("by_agent", (q) => q.eq("agent", a._id)).order("desc").take(500);
    const burns = await ctx.db.query("launchBurns").withIndex("by_agent", (q) => q.eq("agent", a._id)).order("desc").take(500);
    const rounds = await ctx.db.query("launchHolderRounds").withIndex("by_agent", (q) => q.eq("agent", a._id)).order("desc").take(500);
    const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n).toString();
    return {
      allocation: allocationOf(a, now),
      pending,
      claimedLamports: sum(claims.map((c) => c.lamports)),
      toBankrollLamports: sum(claims.map((c) => c.split.bankroll)),
      burnedLamports: sum(burns.map((b) => b.lamports)),
      airdroppedLamports: sum(rounds.filter((r) => r.status === "done").map((r) => r.total)),
      creatorPool: (a.creatorPool ?? 0n).toString(),
      holdersPool: (a.holdersPool ?? 0n).toString(),
    };
  },
});

// ---------------- reserved lamports (owed out of the wallet, never traded or swept) ----------------

async function owedTreasuryOf(db: DatabaseReader, agent: AgentId): Promise<bigint> {
  let out = 0n;
  for (const status of ["pending", "sending", "unknown"] as const) {
    for (const t of await db.query("launchTreasuryTransfers").withIndex("by_agent_status", (q) => q.eq("agent", agent).eq("status", status)).collect()) out += t.lamports;
  }
  return out;
}

/** Payouts that may still land: out of the creator pool but maybe still in the wallet until settled. */
async function inFlightPayoutsOf(db: DatabaseReader, agent: AgentId): Promise<bigint> {
  let out = 0n;
  for (const status of ["sending", "unknown"] as const) {
    for (const p of await db.query("launchPayouts").withIndex("by_agent_status", (q) => q.eq("agent", agent).eq("status", status)).collect()) out += p.lamports;
  }
  return out;
}

async function unpaidRound(db: DatabaseReader, agent: AgentId): Promise<bigint> {
  const round = await db.query("launchHolderRounds").withIndex("by_agent", (q) => q.eq("agent", agent)).order("desc").first();
  if (!round || round.status !== "paying") return 0n;
  const batches = await db.query("launchHolderBatches").withIndex("by_round", (q) => q.eq("round", round._id)).collect();
  return batches.filter((b) => b.status !== "sent" && b.status !== "failed").reduce((s, b) => s + b.transfers.reduce((t, x) => t + x.lamports, 0n), 0n);
}

/** Lamports in the wallet that are not bankroll: both pools, payouts in flight, an unpaid airdrop round, owed treasury. */
export async function reservedOf(db: DatabaseReader, a: Agent): Promise<bigint> {
  return (a.creatorPool ?? 0n) + (a.holdersPool ?? 0n) + (await inFlightPayoutsOf(db, a._id)) + (await unpaidRound(db, a._id)) + (await owedTreasuryOf(db, a._id));
}

/** For the owner's withdraw route: what it may never take out of the agent wallet. */
export const reserved = query({
  args: { secret: v.string(), slug: v.string() },
  handler: async (ctx, { secret, slug }): Promise<string> => {
    if (!secretMatches("launch", secret)) throw new Error("not allowed");
    const a = await ctx.db.query("launchAgents").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    return a ? (await reservedOf(ctx.db, a)).toString() : "0";
  },
});

/**
 * Shutdown sweep: the creator pool goes to the owner with the sweep; a holders pool big enough for a final airdrop
 * stays. Returns what must stay in the wallet (that pool, an unpaid round, owed treasury, payouts in flight).
 */
export const closeOutPools = internalMutation({
  args: { id: vAgent, holdersMinLamports: v.int64() },
  handler: async (ctx, { id, holdersMinLamports }): Promise<bigint> => {
    const a = await ctx.db.get(id);
    if (!a) return 0n;
    const holders = a.holdersPool ?? 0n;
    const keep = holders >= holdersMinLamports ? holders : 0n;
    if ((a.creatorPool ?? 0n) !== 0n || keep !== holders) await ctx.db.patch(id, { creatorPool: 0n, holdersPool: keep });
    if (holders > 0n && keep === 0n) await log(ctx.db, id, "fee", `holders pool of ${(Number(holders) / 1e9).toFixed(3)} SOL is too small for a final airdrop: returned with the bankroll`);
    return keep + (await unpaidRound(ctx.db, id)) + (await owedTreasuryOf(ctx.db, id)) + (await inFlightPayoutsOf(ctx.db, id));
  },
});

// ---------------- cron entry points ----------------

async function launched(db: DatabaseReader): Promise<Agent[]> {
  const out: Agent[] = [];
  // Every launched agent, whatever its age (no first-N window). ponytail: collect() reads them all in one mutation;
  // past ~10k agents, page by_status across chained mutations.
  for (const status of ["live", "paused", "killed"] as const) out.push(...(await db.query("launchAgents").withIndex("by_status", (q) => q.eq("status", status)).collect()));
  return out.filter(feeable);
}

/**
 * Hourly: one fee round per launched agent, spread a second apart (claims hit the RPC and PumpPortal). Shut-down
 * agents too, for good (as snipad): their token still trades, and its fees still owe the treasury share and pay the
 * owner (bookedSplit sends the bankroll share to the owner).
 */
export const feeAll = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (gated()) return 0;
    const agents = await launched(ctx.db);
    for (const [i, a] of agents.entries()) await ctx.scheduler.runAfter(i * 1_000, internal.launchFees.feeOne, { id: a._id });
    return agents.length;
  },
});

/** Agents with an airdrop due, a round to resume, or a wallet policy that may still be widened. */
export const airdropAll = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (gated()) return 0;
    const s = airdropSettings(process.env);
    const now = Date.now();
    const ids = new Set<AgentId>();
    for (const r of await ctx.db.query("launchHolderRounds").withIndex("by_status", (q) => q.eq("status", "paying")).collect()) ids.add(r.agent);
    for (const a of await launched(ctx.db)) {
      const killed = a.status === "killed";
      if (a.airdropPolicyOpen || airdropDue({ pool: a.holdersPool ?? 0n, lastAt: a.holdersAirdropAt ?? null, now, min: killed ? s.finalMinLamports : s.minLamports, killed })) ids.add(a._id);
    }
    for (const [i, id] of [...ids].entries()) await ctx.scheduler.runAfter(i * 2_000, internal.launchFees.airdropOne, { id });
    return ids.size;
  },
});

/** Holder snapshots at a random time in the next ~2 h, for agents with a holders pool or share (anti-sniping). */
export const snapshotAll = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (gated()) return 0;
    const agents = (await launched(ctx.db)).filter((a) => (a.holdersPool ?? 0n) > 0n || (a.allocation?.holders ?? 0) > 0 || (a.pendingAllocation?.allocation.holders ?? 0) > 0);
    for (const a of agents) await ctx.scheduler.runAfter(Math.floor(Math.random() * 110 * 60_000), internal.launchFees.snapshotOne, { id: a._id });
    return agents.length;
  },
});

/**
 * Every 10 minutes: agents with a payout or treasury transfer left in sending/unknown get a reconcile action
 * (launchFees.reconcileOne, under the agent lease); copy buys signed but never recorded get settled too.
 */
export const reconcileAll = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (process.env.MIMIR_BACKEND_OFF === "1") return 0;
    let n = 0;
    if (process.env.LAUNCH_FEES === "1") {
      const ids = new Set<AgentId>();
      for (const status of ["sending", "unknown"] as const) {
        for (const p of await ctx.db.query("launchPayouts").withIndex("by_status", (q) => q.eq("status", status)).collect()) ids.add(p.agent);
        for (const t of await ctx.db.query("launchTreasuryTransfers").withIndex("by_status", (q) => q.eq("status", status)).collect()) ids.add(t.agent);
      }
      for (const [i, id] of [...ids].entries()) await ctx.scheduler.runAfter(i * 1_000, internal.launchFees.reconcileOne, { id });
      n += ids.size;
    }
    const copyBuys = [
      ...(await ctx.db.query("launchCopyJobs").withIndex("by_status", (q) => q.eq("status", "unknown")).collect()),
      ...(await ctx.db.query("launchCopyJobs").withIndex("by_status", (q) => q.eq("status", "running")).collect()),
    ].some((j) => j.kind === "buy" && j.sig);
    if (copyBuys) await ctx.scheduler.runAfter(0, internal.launchCopyJobs.reconcileBuys, {});
    return n;
  },
});

/** One agent's unresolved payouts and treasury transfers (lib/launch/reconcile.ts). */
export const unresolvedFor = internalQuery({
  args: { id: vAgent },
  handler: async (ctx, { id }): Promise<Unresolved[]> => {
    const out: Unresolved[] = [];
    for (const status of ["sending", "unknown"] as const) {
      for (const p of await ctx.db.query("launchPayouts").withIndex("by_agent_status", (q) => q.eq("agent", id).eq("status", status)).collect()) {
        out.push({ kind: "payout", id: p._id, agent: id, sig: p.sig ?? null, lastValidBlockHeight: p.lastValidBlockHeight ?? null, status });
      }
      for (const t of await ctx.db.query("launchTreasuryTransfers").withIndex("by_agent_status", (q) => q.eq("agent", id).eq("status", status)).collect()) {
        out.push({ kind: "treasury", id: t._id, agent: id, sig: t.sig ?? null, lastValidBlockHeight: t.lastValidBlockHeight ?? null, status });
      }
    }
    return out;
  },
});

// ---------------- FeeStore ----------------

export const feeAgent = internalQuery({
  args: { id: vAgent },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || !feeable(a)) return null;
    return {
      id: a._id as string, ticker: a.ticker, mint: a.mint, pad: a.launch?.pad ?? null, creator: a.owner, walletId: a.solana.walletId, wallet: a.solana.address,
      status: a.status, feesClaimedAt: a.feesClaimedAt ?? null, pendingClaim: a.pendingClaim ?? null, slippageBps: (a.trading.risk as { slippageBps?: number } | null)?.slippageBps ?? 300,
      ...allocationState(a), creatorPool: a.creatorPool ?? 0n,
    };
  },
});

export const markClaimed = internalMutation({
  args: { id: vAgent },
  handler: async (ctx, { id }) => void (await ctx.db.patch(id, { feesClaimedAt: Date.now() })),
});

/** The claim's signature, stored before broadcast: a claim that lands after a timeout is booked on the next round. */
export const claimSigned = internalMutation({
  args: { id: vAgent, sig: v.string(), lastValidBlockHeight: v.number() },
  handler: async (ctx, { id, sig, lastValidBlockHeight }) => void (await ctx.db.patch(id, { pendingClaim: { sig, lastValidBlockHeight } })),
});

/** The pending claim is settled (booked, or provably never landed). */
export const clearPendingClaim = internalMutation({
  args: { id: vAgent, sig: v.string() },
  handler: async (ctx, { id, sig }) => {
    const a = await ctx.db.get(id);
    if (a?.pendingClaim?.sig === sig) await ctx.db.patch(id, { pendingClaim: undefined });
  },
});

const vSplit = v.object({ platform: v.int64(), llm: v.int64(), bankroll: v.int64(), buyback: v.int64(), creatorPayout: v.int64(), holders: v.int64() });
type Pools = { creatorPool: bigint; holdersPool: bigint };
const pools = (a: Agent | null): Pools => ({ creatorPool: a?.creatorPool ?? 0n, holdersPool: a?.holdersPool ?? 0n });

/** Once per sig: the claim row, the treasury share owed (L1), a due allocation folded in, and the pools accrued. */
export const recordClaim = internalMutation({
  args: { id: vAgent, lamports: v.int64(), split: vSplit, allocation: vAllocation, accrue: v.boolean(), sig: v.string() },
  handler: async (ctx, a): Promise<Pools> => {
    const agent = await ctx.db.get(a.id);
    if (agent?.pendingClaim?.sig === a.sig) await ctx.db.patch(a.id, { pendingClaim: undefined });
    if (await ctx.db.query("launchFeeClaims").withIndex("by_sig", (q) => q.eq("sig", a.sig)).first()) return pools(agent);
    const now = Date.now();
    await ctx.db.insert("launchFeeClaims", { agent: a.id, lamports: a.lamports, split: a.split, allocation: a.allocation, sig: a.sig, at: now });
    const owed = a.split.platform + a.split.llm;
    if (owed > 0n) await ctx.db.insert("launchTreasuryTransfers", { agent: a.id, claimSig: a.sig, lamports: owed, status: "pending", at: now });
    if (!agent) return pools(null);
    const fresh = await applyDue(ctx.db, agent, now);
    // Part of a claim is bankroll: a sleeping agent gets its wake check on the next tick.
    if (fresh.idle) await ctx.db.patch(a.id, { idle: { ...fresh.idle, wakeRequestedAt: now } });
    if (!a.accrue) return pools(fresh);
    const next = { creatorPool: (fresh.creatorPool ?? 0n) + a.split.creatorPayout, holdersPool: (fresh.holdersPool ?? 0n) + a.split.holders };
    await ctx.db.patch(a.id, next);
    return next;
  },
});

export const recordBurn = internalMutation({
  args: { id: vAgent, mint: v.string(), lamports: v.int64(), tokens: v.int64(), buySig: v.string(), burnSig: v.string() },
  handler: async (ctx, { id, ...b }) => {
    if (await ctx.db.query("launchBurns").withIndex("by_burnSig", (q) => q.eq("burnSig", b.burnSig)).first()) return;
    await ctx.db.insert("launchBurns", { agent: id, ...b, at: Date.now() });
  },
});

export const event = internalMutation({
  args: { id: vAgent, kind: v.string(), text: v.string() },
  handler: async (ctx, { id, kind, text }) => void (await log(ctx.db, id, kind, text)),
});

export const beginCreatorPayout = internalMutation({
  args: { id: vAgent, lamports: v.int64() },
  handler: async (ctx, { id, lamports }): Promise<Id<"launchPayouts"> | null> => {
    const a = await ctx.db.get(id);
    if (!a || lamports <= 0n || (a.creatorPool ?? 0n) < lamports) return null;
    for (const status of ["sending", "unknown"] as const) {
      if (await ctx.db.query("launchPayouts").withIndex("by_agent_status", (q) => q.eq("agent", id).eq("status", status)).first()) return null;
    }
    await ctx.db.patch(id, { creatorPool: (a.creatorPool ?? 0n) - lamports });
    return ctx.db.insert("launchPayouts", { agent: id, lamports, status: "sending", at: Date.now() });
  },
});

export const payoutSigned = internalMutation({
  args: { payout: v.id("launchPayouts"), sig: v.string(), lastValidBlockHeight: v.number() },
  handler: async (ctx, { payout, sig, lastValidBlockHeight }) => {
    const p = await ctx.db.get(payout);
    if (!p || p.status !== "sending") throw new Error(`payout ${payout} is not sending`);
    await ctx.db.patch(payout, { sig, lastValidBlockHeight });
  },
});

export const finishCreatorPayout = internalMutation({
  args: { payout: v.id("launchPayouts"), status: v.union(v.literal("sent"), v.literal("failed"), v.literal("unknown")), sig: v.optional(v.string()) },
  handler: async (ctx, { payout, status, sig }) => {
    const p = await ctx.db.get(payout);
    if (!p || p.status === "sent" || p.status === "failed") return;
    await ctx.db.patch(payout, { status, ...(sig ? { sig } : {}), doneAt: Date.now() });
    if (status === "failed") {
      const a = await ctx.db.get(p.agent);
      if (a) await ctx.db.patch(a._id, { creatorPool: (a.creatorPool ?? 0n) + p.lamports });
    }
  },
});

export const owedTreasury = internalQuery({
  args: { id: vAgent },
  handler: async (ctx, { id }): Promise<{ id: string; lamports: bigint }[]> =>
    (await ctx.db.query("launchTreasuryTransfers").withIndex("by_agent_status", (q) => q.eq("agent", id).eq("status", "pending")).collect()).map((r) => ({ id: r._id as string, lamports: r.lamports })),
});

export const treasurySigned = internalMutation({
  args: { transfer: v.id("launchTreasuryTransfers"), sig: v.string(), lastValidBlockHeight: v.number() },
  handler: async (ctx, { transfer, sig, lastValidBlockHeight }) => {
    const t = await ctx.db.get(transfer);
    if (!t || t.status !== "pending") throw new Error(`treasury transfer ${transfer} cannot be sent again`);
    await ctx.db.patch(transfer, { status: "sending", sig, lastValidBlockHeight });
  },
});

export const finishTreasury = internalMutation({
  args: { transfer: v.id("launchTreasuryTransfers"), status: v.union(v.literal("sent"), v.literal("pending"), v.literal("unknown")), sig: v.optional(v.string()) },
  handler: async (ctx, { transfer, status, sig }) => {
    const t = await ctx.db.get(transfer);
    if (!t || t.status === "sent") return;
    await ctx.db.patch(transfer, status === "pending" ? { status, sig: undefined, lastValidBlockHeight: undefined } : { status, ...(sig ? { sig } : {}), ...(status === "sent" ? { doneAt: Date.now() } : {}) });
  },
});

// ---------------- AirdropStore ----------------

export const airdropAgent = internalQuery({
  args: { id: vAgent },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || !feeable(a)) return null;
    return {
      id: a._id as string, ticker: a.ticker, mint: a.mint, walletId: a.solana.walletId, wallet: a.solana.address, creator: a.owner, status: a.status,
      holdersPool: a.holdersPool ?? 0n, holdersAirdropAt: a.holdersAirdropAt ?? null,
    };
  },
});

const openRoundDoc = async (db: DatabaseReader, agent: AgentId) => {
  const r = await db.query("launchHolderRounds").withIndex("by_agent", (q) => q.eq("agent", agent)).order("desc").first();
  return r?.status === "paying" ? r : null;
};

async function view(db: DatabaseReader, r: Doc<"launchHolderRounds">): Promise<RoundView> {
  const batches = await db.query("launchHolderBatches").withIndex("by_round", (q) => q.eq("round", r._id)).collect();
  return {
    id: r._id, total: r.total, recipients: r.recipients,
    batches: batches.map((b) => ({
      id: b._id, idx: b.idx, transfers: b.transfers, status: b.status, ...(b.attempts !== undefined ? { attempts: b.attempts } : {}),
      ...(b.sig ? { sig: b.sig } : {}), ...(b.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: b.lastValidBlockHeight } : {}),
    })),
  };
}

export const openRound = internalQuery({
  args: { id: vAgent },
  handler: async (ctx, { id }): Promise<RoundView | null> => {
    const r = await openRoundDoc(ctx.db, id);
    return r ? view(ctx.db, r) : null;
  },
});

const vTransfer = v.object({ to: v.string(), lamports: v.int64() });

export const createRound = internalMutation({
  args: { id: vAgent, batches: v.array(v.array(vTransfer)), total: v.int64(), recipients: v.number() },
  handler: async (ctx, a): Promise<RoundView | null> => {
    const agent = await ctx.db.get(a.id);
    const sum = a.batches.flat().reduce((s, t) => s + t.lamports, 0n);
    if (!agent || sum !== a.total || a.total <= 0n || (agent.holdersPool ?? 0n) < a.total || (await openRoundDoc(ctx.db, a.id))) return null;
    const now = Date.now();
    await ctx.db.patch(a.id, { holdersPool: (agent.holdersPool ?? 0n) - a.total });
    const round = await ctx.db.insert("launchHolderRounds", { agent: a.id, total: a.total, recipients: a.recipients, status: "paying", at: now });
    for (const [idx, transfers] of a.batches.entries()) await ctx.db.insert("launchHolderBatches", { round, agent: a.id, idx, transfers, status: "planned" });
    const doc = await ctx.db.get(round);
    return doc && view(ctx.db, doc);
  },
});

export const markSending = internalMutation({
  args: { batch: v.id("launchHolderBatches"), sig: v.string(), lastValidBlockHeight: v.number() },
  handler: async (ctx, { batch, sig, lastValidBlockHeight }) => {
    const b = await ctx.db.get(batch);
    if (!b || b.status === "sent") throw new Error(`batch ${batch} cannot be sent again`);
    await ctx.db.patch(batch, { status: "sending", sig, lastValidBlockHeight });
  },
});

/** Returns the batch's provably-not-landed attempts so far (planned increments it). */
export const markBatch = internalMutation({
  args: { batch: v.id("launchHolderBatches"), status: v.union(v.literal("sent"), v.literal("planned")), sig: v.optional(v.string()) },
  handler: async (ctx, { batch, status, sig }): Promise<number> => {
    const b = await ctx.db.get(batch);
    if (!b || b.status === "sent" || b.status === "failed") return b?.attempts ?? 0;
    if (status === "sent") {
      await ctx.db.patch(batch, { status, sig: sig ?? b.sig });
      return b.attempts ?? 0;
    }
    const attempts = (b.attempts ?? 0) + 1;
    await ctx.db.patch(batch, { status, sig: undefined, lastValidBlockHeight: undefined, attempts });
    return attempts;
  },
});

/** Bisect a planned batch: it keeps the first half, a new planned batch gets the rest. */
export const splitBatch = internalMutation({
  args: { batch: v.id("launchHolderBatches") },
  handler: async (ctx, { batch }) => {
    const b = await ctx.db.get(batch);
    if (!b || b.status !== "planned" || b.transfers.length < 2) return;
    const half = Math.ceil(b.transfers.length / 2);
    const siblings = await ctx.db.query("launchHolderBatches").withIndex("by_round", (q) => q.eq("round", b.round)).collect();
    const idx = Math.max(...siblings.map((x) => x.idx)) + 1;
    await ctx.db.patch(batch, { transfers: b.transfers.slice(0, half), attempts: 0 });
    await ctx.db.insert("launchHolderBatches", { round: b.round, agent: b.agent, idx, transfers: b.transfers.slice(half), status: "planned" });
  },
});

/** Give up on a planned batch; its lamports go back to the holders pool. */
export const dropBatch = internalMutation({
  args: { batch: v.id("launchHolderBatches"), reason: v.string() },
  handler: async (ctx, { batch }) => {
    const b = await ctx.db.get(batch);
    if (!b || b.status !== "planned") return;
    await ctx.db.patch(batch, { status: "failed" });
    const a = await ctx.db.get(b.agent);
    if (a) await ctx.db.patch(a._id, { holdersPool: (a.holdersPool ?? 0n) + b.transfers.reduce((t, x) => t + x.lamports, 0n) });
  },
});

export const priorSnapshot = internalQuery({
  args: { id: vAgent, from: v.number(), to: v.number(), pick: v.number() },
  handler: async (ctx, { id, from, to, pick }): Promise<{ owner: string; amount: bigint }[] | null> => {
    const rows = await ctx.db.query("launchHolderSnapshots").withIndex("by_agent_at", (q) => q.eq("agent", id).gte("at", from).lte("at", to)).collect();
    if (!rows.length) return null;
    return rows[Math.min(rows.length - 1, Math.max(0, Math.floor(pick * rows.length)))].balances;
  },
});

export const saveSnapshot = internalMutation({
  args: { id: vAgent, at: v.number(), balances: v.array(v.object({ owner: v.string(), amount: v.int64() })) },
  handler: async (ctx, { id, at, balances }) => {
    await ctx.db.insert("launchHolderSnapshots", { agent: id, at, balances });
    // ponytail: keep the last 2 days of snapshots per agent (a round reads 6-18 h back).
    const old = await ctx.db.query("launchHolderSnapshots").withIndex("by_agent_at", (q) => q.eq("agent", id).lt("at", at - 48 * 3600_000)).take(50);
    for (const o of old) await ctx.db.delete(o._id);
  },
});

/** A shut-down agent's final pool that can pay nobody goes back to the bankroll (the sweep returns it). */
export const releaseHoldersPool = internalMutation({
  args: { id: vAgent },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (a?.status === "killed") await ctx.db.patch(id, { holdersPool: 0n });
  },
});

export const policyWidened = internalMutation({
  args: { id: vAgent, open: v.boolean() },
  handler: async (ctx, { id, open }) => {
    const a = await ctx.db.get(id);
    if (a && (a.airdropPolicyOpen ?? false) !== open) await ctx.db.patch(id, { airdropPolicyOpen: open || undefined });
  },
});

export const finishRound = internalMutation({
  args: { round: v.id("launchHolderRounds") },
  handler: async (ctx, { round }) => {
    const r = await ctx.db.get(round);
    if (!r || r.status === "done") return;
    const batches = await ctx.db.query("launchHolderBatches").withIndex("by_round", (q) => q.eq("round", round)).collect();
    if (batches.some((b) => b.status !== "sent" && b.status !== "failed")) throw new Error(`round ${round} has unpaid batches`);
    const now = Date.now();
    await ctx.db.patch(round, { status: "done", doneAt: now });
    await ctx.db.patch(r.agent, { holdersAirdropAt: now });
  },
});

export { FINAL_ROUND_MIN_LAMPORTS };
