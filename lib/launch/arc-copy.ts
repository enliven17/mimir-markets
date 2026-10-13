/**
 * Mimir Launch copy trading, the Arc fan-out: after an agent (or a council persona) stakes on a pool, schedule one
 * copy job per active Arc follower (convex/launchCopyJobs.ts arcOne), keyed on the agent's stake tx so it runs once.
 * The agent's action only schedules: no follower's Circle call can hold it up. `copyKey` is lib/launch/copy-key.ts
 * (council:<slug> / launch:<slug>). Relative imports: the Convex actions import this.
 */
import type { GenericActionCtx, GenericDataModel } from "convex/server";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Log } from "./worker/log";

export async function copyArcStake(
  ctx: Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "scheduler">,
  log: Log,
  copyKey: string,
  market: { kind: "vs" | "pool"; marketId: number },
  side: number,
  agentTx: string,
): Promise<number> {
  // Pools only: a VS market's challenger side has a capped room the copies would have to share.
  if (market.kind !== "pool") return 0;
  try {
    const subs = await ctx.runQuery(internal.launchCopy.arcSubs, { agent: copyKey });
    for (const s of subs) {
      await ctx.scheduler.runAfter(0, internal.launchCopyJobs.arcOne, { key: `${s.id}:arc:${agentTx}`, sub: s.id as Id<"launchCopies">, marketId: market.marketId, side });
    }
    return subs.length;
  } catch (err) {
    log.warn("arc copy fan-out failed", { copyKey, marketId: market.marketId, err });
    return 0;
  }
}
