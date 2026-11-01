"use node";

// Mimir Launch copy staking, one follower at a time (lib/launch/copy-stake.ts). The agent ticks (launchArc, arcCouncil)
// only schedule these, one per follower and agent stake, so a slow follower never holds up the agent or the others
// and a long fan-out never runs past an action's time limit. Each job runs once (its key).
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { indexToUsd, usdToIndex } from "../lib/chains/amounts";
import { serverMarketChains } from "../lib/chains/registry";
import { runArcCopy } from "../lib/launch/copy-stake";
import { createConsoleLogger } from "../lib/launch/log";
import { circleStake, walletGasWei, walletUsdcWei } from "../lib/server/chain-circle";
import { vChain } from "./schema";

const log = createConsoleLogger({ level: process.env.LOG_LEVEL, base: { svc: "launch-copy" } });
const gated = () => process.env.MIMIR_BACKEND_OFF === "1";

/** One follower's copy of a leader's pool stake, on the leader's chain, from the follower's copy wallet there. */
export const arcOne = internalAction({
  args: { key: v.string(), sub: v.id("launchCopies"), chain: v.optional(vChain), marketId: v.number(), side: v.number() },
  handler: async (ctx, a): Promise<string> => {
    if (gated()) return "gated";
    const chain = a.chain ?? "arc";
    const cfg = serverMarketChains().chains[chain];
    if (!cfg.enabled) return "chain off";
    try {
      return await runArcCopy(
        {
          store: {
            claim: (key, sub) => ctx.runMutation(internal.launchCopy.claim, { key, sub: sub as typeof a.sub, chain }),
            finish: async (key, status, note) => void (await ctx.runMutation(internal.launchCopy.finish, { key, status, ...(note ? { note } : {}) })),
            arcSub: (id) => ctx.runQuery(internal.launchCopy.arcSub, { sub: id as typeof a.sub, chain }),
          },
          // On Base a copy wallet without ETH cannot pay gas: it counts as empty (skipped, "copy wallet short").
          balanceUsdc: async (wallet) =>
            cfg.gas.symbol === "ETH" && (await walletGasWei(cfg, wallet)) === 0n ? 0 : indexToUsd(await walletUsdcWei(cfg, wallet)),
          stake: ({ walletId, marketId, side, amountUsdc }) =>
            ctx.runQuery(internal.launchCopy.arcSub, { sub: a.sub, chain }).then((s) =>
              circleStake(cfg, { walletId, address: s?.wallet ?? "" }, { kind: "pool", marketId, side, wei: usdToIndex(amountUsdc) }),
            ),
          log,
          minStakeUsdc: indexToUsd(cfg.contracts.minStakeWei),
        },
        a,
      );
    } catch (err) {
      log.error("arc copy job failed", { key: a.key, err });
      return "failed";
    }
  },
});
