import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { DEFAULT_COPY_RISK, copyRiskProblem, copyQuoteProblem } from "../lib/launch/copy-risk";
import { secretMatches } from "../lib/internal-secrets";
import { buySpendCeiling } from "../lib/launch/spend-ceiling";

export const reserve = internalMutation({
  args: { key: v.string(), sub: v.id("launchCopies"), mint: v.string(), lamports: v.string(), quote: v.object({ referencePrice: v.optional(v.number()), signalAt: v.optional(v.number()), price: v.number(), liquiditySol: v.number(), checkedAt: v.number() }) },
  handler: async (ctx, a): Promise<string | null> => {
    const s = await ctx.db.get(a.sub);
    const j = await ctx.db.query("launchCopyJobs").withIndex("by_key", (q) => q.eq("key", a.key)).unique();
    if (!s?.active || !s.solana?.on || j?.status !== "running" || j.sub !== a.sub) return "Copy is no longer active.";
    const p = (await ctx.db.query("copyRiskPolicies").withIndex("by_follower", (q) => q.eq("follower", s.follower)).unique())?.policy ?? DEFAULT_COPY_RISK;
    if (Date.now() - a.quote.checkedAt > 15_000 || a.quote.checkedAt > Date.now() + 5000) return "Copy quote expired.";
    const quoteProblem = copyQuoteProblem(p, { ...a.quote, now: Date.now() }, BigInt(a.lamports));
    if (quoteProblem) return quoteProblem;
    const ledger = await ctx.db.query("copyRiskLedgers").withIndex("by_follower", (q) => q.eq("follower", s.follower)).unique();
    const subs = await ctx.db.query("launchCopies").withIndex("by_follower", (q) => q.eq("follower", s.follower)).take(101);
    if (subs.length > 100) return "Too many copy wallets to verify exposure.";
    let tokenCost = 0n, totalCost = 0n;
    for (const sub of subs) {
      const positions = await ctx.db.query("launchCopyPositions").withIndex("by_sub", (q) => q.eq("sub", sub._id)).take(501);
      if (positions.length > 500) return "Copy exposure record exceeds the verification limit.";
      for (const row of positions) { totalCost += BigInt(row.costLamports); if (row.mint === a.mint) tokenCost += BigInt(row.costLamports); }
      for (const status of ["running", "unknown"] as const) {
        const pending = await ctx.db.query("launchCopyJobs").withIndex("by_sub_status", (q) => q.eq("sub", sub._id).eq("status", status)).take(101);
        if (pending.length > 100) return "Copy reservations are busy; waiting for reconciliation.";
        for (const row of pending) if (row.key !== a.key && row.riskLamports) { totalCost += BigInt(row.riskLamports); if (row.mint === a.mint) tokenCost += BigInt(row.riskLamports); }
      }
    }
    const reserved = buySpendCeiling(BigInt(a.lamports));
    const signal = a.key.split(":buy:").at(-1)!;
    const fanout = await ctx.db.query("launchCopyJobs").withIndex("by_signal", (q) => q.eq("signal", signal)).take(1001);
    if (fanout.length > 1000) return "Copy signal capacity reached.";
    const signalCost = fanout.filter((row) => row.key !== a.key && ["running", "unknown", "done"].includes(row.status)).reduce((sum, row) => sum + BigInt(row.riskLamports ?? "0"), 0n);
    const capacity = BigInt(Math.floor(a.quote.liquiditySol * 1e9 / 100)); // at most 1% of quoted liquidity per signal
    if (signalCost + reserved > capacity) return "This signal's shared copy liquidity capacity is full.";
    const problem = copyRiskProblem(p, { tokenCost, totalCost, dailyPnl: ledger?.day === new Date().toISOString().slice(0, 10) ? BigInt(ledger.dailyPnl) : 0n, pnl: BigInt(ledger?.pnl ?? "0"), peak: BigInt(ledger?.peak ?? "0") }, reserved);
    if (!problem) await ctx.db.patch(j._id, { mint: a.mint, signal, riskLamports: reserved.toString() });
    return problem;
  },
});


export const policy = query({
  args: { secret: v.string(), follower: v.string() },
  handler: async (ctx, { secret, follower }) => {
    if (!secretMatches("launch", secret)) throw new Error("not allowed");
    return (await ctx.db.query("copyRiskPolicies").withIndex("by_follower", (q) => q.eq("follower", follower)).unique())?.policy ?? DEFAULT_COPY_RISK;
  },
});
