// Contract cutover: the new MimirV3 / MimirPool restart market ids at 1, so the old index must go before arcSync reads
// the new contracts (else old rows collide with new ids). Deletes every row of the arc* index tables in batches,
// rescheduling itself until they are empty; arcSync then re-indexes from MIMIR_ARC_FROM_BLOCK (the cursor is wiped too).
// Internal only; run on purpose, per deployment, after the new addresses are in the env and with the crons paused:
//   npx convex run arcCutover:wipeArcIndex '{"confirm":"wipe-arc-index"}'            (dev)
//   npx convex run --prod arcCutover:wipeArcIndex '{"confirm":"wipe-arc-index"}'     (prod, at cutover only)
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const TABLES = [
  "arcMarkets",
  "arcPositions",
  "arcEvents",
  "arcCursor",
  "arcVerdicts",
  "arcOracleTries",
  "arcCouncilDecisions",
  "arcMarketTakes",
  "arcTriage",
] as const;
const BATCH = 500;

export const wipeArcIndex = internalMutation({
  args: { confirm: v.literal("wipe-arc-index") },
  handler: async (ctx, { confirm }) => {
    const deleted: Record<string, number> = {};
    let more = false;
    for (const t of TABLES) {
      const rows = await ctx.db.query(t).take(BATCH);
      for (const r of rows) await ctx.db.delete(r._id);
      if (rows.length) deleted[t] = rows.length;
      if (rows.length === BATCH) more = true;
    }
    if (more) await ctx.scheduler.runAfter(0, internal.arcCutover.wipeArcIndex, { confirm });
    console.log(`[cutover] deleted ${JSON.stringify(deleted)}${more ? ", continuing" : ", done"}`);
    return { deleted, more };
  },
});
