// One-off migration for the Arc + Base model (2026-11-01): agents only stake, their token is the owner's own, Solana,
// Robinhood, the fee machinery and the preview are gone. Rewrites the rows the new schema (convex/schema.ts) would
// refuse and empties the dropped tables. Idempotent: run it until it reports nothing left.
//
//   1. Deploy this build once with `defineSchema({...}, { schemaValidation: false })` in convex/schema.ts.
//   2. npx convex run launchMigrate:run            (repeat while `more` is true)
//   3. Deploy again with schema validation on (the file as committed).
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Tables the new schema no longer has. */
const DROPPED = [
  "launchPositions", "launchTrades", "launchCopyPositions", "copyRiskPolicies", "copyRiskLedgers", "copyExecutionReceipts",
  "launchFeeClaims", "launchTreasuryTransfers", "launchPayouts", "launchBurns", "launchHolderRounds", "launchHolderBatches",
  "launchHolderSnapshots", "demoSessions", "demoAgents", "demoStakes", "demoBaskets", "demoControl",
] as const;

/** launchAgents fields the new schema dropped. */
const AGENT_FIELDS = [
  "trading", "venue", "solana", "robinhood", "mint", "argusFees", "launch", "fundingSig", "sleepUntil", "idle", "sweptAt",
  "allocation", "pendingAllocation", "creatorPool", "holdersPool", "feesClaimedAt", "pendingClaim", "holdersAirdropAt",
  "airdropPolicyOpen",
] as const;

type Loose = Record<string, unknown> & { _id: string };

export const run = internalMutation({
  args: { batch: v.optional(v.number()) },
  handler: async (ctx, { batch = 200 }) => {
    // The dropped tables and the old shapes are not in the generated types: this file works on raw documents.
    const db = ctx.db as unknown as {
      query(t: string): { take(n: number): Promise<Loose[]> };
      patch(id: string, v: Record<string, unknown>): Promise<void>;
      replace(id: string, v: Record<string, unknown>): Promise<void>;
      delete(id: string): Promise<void>;
    };
    const report: Record<string, number> = {};
    let more = false;

    for (const t of DROPPED) {
      let rows: Loose[] = [];
      try {
        rows = await db.query(t).take(batch);
      } catch {
        continue; // never existed on this deployment
      }
      for (const r of rows) await db.delete(r._id);
      if (rows.length) report[t] = rows.length;
      if (rows.length === batch) more = true;
    }

    // Agents: an agent with no Arc wallet never launched anything Arc can use (a pending Solana or Robinhood launch):
    // it is removed with its events. A pending one with a wallet goes live. The old Argus token keeps its address and
    // splitter (its fees now go to whoever the splitter names: the agent's wallet). A pump.fun, Pons or agent-launched
    // Clanker token is not carried over.
    let agents = 0, removed = 0;
    for (const a of await db.query("launchAgents").take(10_000)) {
      if (!a.arc) {
        for (const e of await ctx.db.query("launchEvents").withIndex("by_agent", (q) => q.eq("agent", a._id as never)).take(1000)) await ctx.db.delete(e._id);
        await db.delete(a._id);
        removed++;
        continue;
      }
      const dirty = AGENT_FIELDS.some((f) => a[f] !== undefined) || a.status === "pending" || (a.token && !(a.token as Record<string, unknown>).launchTx) || (a.base && (a.base as Record<string, unknown>).payout !== undefined);
      if (!dirty) continue;
      const patch: Record<string, unknown> = {};
      for (const f of AGENT_FIELDS) if (a[f] !== undefined) patch[f] = undefined;
      if (a.status === "pending") patch.status = "live";
      const t = a.token as { chain?: string; address?: string; splitter?: string; tx?: string; launchTx?: string } | undefined;
      if (t && !t.launchTx) patch.token = t.address ? { chain: "arc", address: t.address, ...(t.splitter ? { splitter: t.splitter } : {}), launchTx: t.tx ?? "" } : undefined;
      const b = a.base as { walletId?: string; address?: string } | undefined;
      if (b) patch.base = undefined; // the old Base wallet was a Privy wallet; a Circle one is made when Base staking comes
      await db.patch(a._id, patch);
      agents++;
    }
    if (agents) report.launchAgents = agents;
    if (removed) report.launchAgentsRemoved = removed;

    // Events: only "arc" and "base" remain as chains.
    let events = 0;
    for (const e of (await db.query("launchEvents").take(20_000)) as Loose[]) {
      if (e.chain !== undefined && e.chain !== "arc" && e.chain !== "base") {
        await db.patch(e._id, { chain: undefined });
        events++;
      }
    }
    if (events) report.launchEvents = events;

    // Copy subscriptions lose their Solana side; a subscription that had only that side is removed.
    let copies = 0;
    for (const c of await db.query("launchCopies").take(10_000)) {
      if (c.solana === undefined) continue;
      if (!c.arc) await db.delete(c._id);
      else await db.patch(c._id, { solana: undefined });
      copies++;
    }
    if (copies) report.launchCopies = copies;

    // Copy jobs: Arc jobs keep key, sub, status, note, at; Solana buy and sell jobs go.
    let jobs = 0;
    for (const j of await db.query("launchCopyJobs").take(20_000)) {
      if (j.kind !== undefined && j.kind !== "arc") {
        await db.delete(j._id);
        jobs++;
        continue;
      }
      const stale = ["kind", "mint", "sig", "lastValidBlockHeight", "riskLamports", "signal"].filter((f) => j[f] !== undefined);
      if (!stale.length) continue;
      await db.patch(j._id, Object.fromEntries(stale.map((f) => [f, undefined])));
      jobs++;
    }
    if (jobs) report.launchCopyJobs = jobs;

    // App records of the removed campaign (points, invites).
    let records = 0;
    for (const t of ["campaign_invites", "campaign_codes"]) {
      const rows = await ctx.db.query("appStore").withIndex("by_key", (q) => q.eq("t", t)).take(batch);
      for (const r of rows) await ctx.db.delete(r._id);
      records += rows.length;
      if (rows.length === batch) more = true;
    }
    if (records) report.appStoreCampaign = records;

    return { report, more };
  },
});
