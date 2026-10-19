// The watchdog's reads and its "already told the admin" memory (convex/arcWatch.ts).
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** What the watchdog checks from the index: live proposals with our recorded verdict, open disputes, stuck retries, job heartbeats. */
export const snapshot = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const byStatus = (st: "proposed" | "disputed") =>
      ctx.db.query("arcMarkets").withIndex("by_status_deadline", (q) => q.eq("status", st)).take(200);
    const proposed = [];
    for (const m of await byStatus("proposed")) {
      if (m.disputableUntil <= now) continue;
      const verdict = await ctx.db.query("arcVerdicts").withIndex("by_market", (q) => q.eq("kind", m.kind).eq("marketId", m.marketId)).order("desc").first();
      proposed.push({ kind: m.kind, marketId: m.marketId, question: m.question, disputableUntil: m.disputableUntil, verdictSide: verdict?.side ?? null });
    }
    const disputed = (await byStatus("disputed")).map((m) => ({ kind: m.kind, marketId: m.marketId, question: m.question, vetoed: m.vetoed ?? false, refundAt: m.refundAt }));
    const stuck = (await ctx.db.query("arcOracleTries").take(500)).filter((t) => t.attempts >= 6 && t.lastError).map((t) => ({ kind: t.kind, marketId: t.marketId, attempts: t.attempts, lastError: t.lastError ?? "" }));
    const heartbeats = (await ctx.db.query("arcHeartbeats").take(50)).map((h) => ({ name: h.name, at: h.at }));
    return { proposed, disputed, stuck, heartbeats };
  },
});

/** True the first time `key` is seen (or once its silence ran out); then stays quiet for `ttlMs`. */
export const claim = internalMutation({
  args: { key: v.string(), ttlMs: v.number() },
  handler: async (ctx, { key, ttlMs }) => {
    const now = Date.now();
    const row = await ctx.db.query("arcAlerts").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row && row.until > now) return false;
    if (row) await ctx.db.patch(row._id, { until: now + ttlMs });
    else await ctx.db.insert("arcAlerts", { key, until: now + ttlMs });
    return true;
  },
});
