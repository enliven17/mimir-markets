"use node";

// Mimir Launch, the Base side of an agent (venue "base"): its own Clanker token's creator fees claimed into its
// wallet hourly (WETH from the ClankerFeeLocker, unwrapped to ETH; it becomes bankroll the owner can withdraw), and on
// shutdown a last claim then its ETH back to the owner's payout address (lib/launch/base/round.ts). Arc staking runs in
// convex/launchArc.ts like every agent's. No trading on Base yet. Scheduled per agent by launchSolDb.tickAll.
// Env: LAUNCH_BASE=1, plus lib/launch/base/env.ts (Privy, BASE_RPC_URL, BASE_BUILDER_CODE, LAUNCH_BASE_TREASURY).
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { baseFromEnv } from "../lib/launch/base/env";
import { baseRound } from "../lib/launch/base/round";
import { createConsoleLogger, publicError } from "../lib/launch/worker/log";

const log = createConsoleLogger({ level: process.env.LOG_LEVEL, base: { svc: "launch-base" } });
let cached: ReturnType<typeof baseFromEnv> | null = null;

export const roundOne = internalAction({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }): Promise<string> => {
    if (process.env.MIMIR_BACKEND_OFF === "1" || process.env.LAUNCH_BASE !== "1") return "gated";
    const token = await ctx.runMutation(internal.launchSolDb.acquire, { id });
    if (token === null) return "busy";
    try {
      const agent = await ctx.runQuery(internal.launchSolDb.baseAgent, { id });
      if (!agent) return "missing";
      cached ??= baseFromEnv(process.env);
      const { executor } = cached;
      const aid = (x: string) => x as Id<"launchAgents">;
      const r = await baseRound(agent, {
        claim: executor.claimCreatorFees,
        spendable: executor.spendable,
        transfer: executor.transferEth,
        markClaimed: async (x) => void (await ctx.runMutation(internal.launchSolDb.markFeesClaimed, { id: aid(x) })),
        markSwept: async (x) => void (await ctx.runMutation(internal.launchSolDb.markSwept, { id: aid(x) })),
        log: async (x, kind, text, tx) => void (await ctx.runMutation(internal.launchSolDb.logEvent, { id: aid(x), kind, text, chain: "base", ...(tx ? { tx } : {}) })),
      });
      log.debug("base round", { agentId: id, claimedWei: r.claimedWei.toString(), sweptGwei: r.sweptGwei.toString() });
      return "ok";
    } catch (err) {
      log.error("base round failed", { agentId: id, err: publicError(err) });
      return "failed";
    } finally {
      await ctx.runMutation(internal.launchSolDb.release, { id, token });
    }
  },
});
