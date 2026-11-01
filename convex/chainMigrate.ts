// Backfill for the Base + Arc model (2026-11-01): rows indexed before Base have no `chain`; they are Arc's. Every
// market-keyed index now starts with `chain`, so those rows are invisible to (chain, kind, marketId) reads until they
// carry "arc". Idempotent and cheap when done (one index probe per table). The Arc indexer runs it at the start of
// each tick (convex/arcSync.ts), so a deploy heals itself within a tick; it can also be run by hand:
//
//   npx convex run chainMigrate:run            (repeat while `more` is true)
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Tables whose by_market index leads with `chain`. */
const TABLES = [
  "arcMarkets",
  "arcPositions",
  "arcEvents",
  "arcVerdicts",
  "arcOracleTries",
  "arcCouncilDecisions",
  "arcMarketTakes",
  "arcTriage",
  "councilOpinions",
  "launchStakes",
] as const;

export const run = internalMutation({
  args: { batch: v.optional(v.number()) },
  handler: async (ctx, { batch = 300 }) => {
    const report: Record<string, number> = {};
    let more = false;
    for (const t of TABLES) {
      const rows = await ctx.db
        .query(t)
        .withIndex("by_market", (q) => q.eq("chain", undefined))
        .take(batch);
      for (const r of rows) await ctx.db.patch(r._id, { chain: "arc" as const });
      if (rows.length) report[t] = rows.length;
      if (rows.length === batch) more = true;
    }
    return { report, more };
  },
});
