"use node";

// Mimir Launch copy staking, one follower at a time (lib/launch/copy-stake.ts). The agent ticks (launchArc, arcCouncil)
// only schedule these, one per follower and agent stake, so a slow follower never holds up the agent or the others
// and a long fan-out never runs past an action's time limit. Each job runs once (its key).
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { arcPublicClient } from "../lib/arc/chain";
import { arcConfig } from "../lib/arc/config";
import { runArcCopy } from "../lib/launch/copy-stake";
import { createConsoleLogger } from "../lib/launch/log";
import { executeContract } from "../lib/server/circle-w3s";

const log = createConsoleLogger({ level: process.env.LOG_LEVEL, base: { svc: "launch-copy" } });
const ZERO = "0x0000000000000000000000000000000000000000";
const gated = () => process.env.MIMIR_BACKEND_OFF === "1";
const arc = () => arcConfig({ network: process.env.ARC_NETWORK, rpcUrl: process.env.ARC_RPC, mimirV3: process.env.MIMIR_V3_ADDRESS, mimirPool: process.env.MIMIR_POOL_ADDRESS, minStake: process.env.MIMIR_MIN_STAKE });

export const arcOne = internalAction({
  args: { key: v.string(), sub: v.id("launchCopies"), marketId: v.number(), side: v.number() },
  handler: async (ctx, a): Promise<string> => {
    if (gated()) return "gated";
    const cfg = arc();
    const pool = cfg.contracts.mimirPool;
    if (!pool) return "no pool";
    const client = arcPublicClient(cfg);
    try {
      return await runArcCopy(
        {
          store: {
            claim: (key, sub) => ctx.runMutation(internal.launchCopy.claim, { key, sub: sub as typeof a.sub }),
            finish: async (key, status, note) => void (await ctx.runMutation(internal.launchCopy.finish, { key, status, ...(note ? { note } : {}) })),
            arcSub: (id) => ctx.runQuery(internal.launchCopy.arcSub, { sub: id as typeof a.sub }),
          },
          balanceUsdc: async (wallet) => Number(await client.getBalance({ address: wallet as `0x${string}` })) / 1e18,
          stake: ({ walletId, marketId, side, amountUsdc }) =>
            executeContract({ walletId, contractAddress: pool, abiFunctionSignature: "stake(uint256,uint8,address)", abiParameters: [BigInt(marketId), side, ZERO], amount: amountUsdc.toFixed(2) }),
          log,
          minStakeUsdc: Number(cfg.contracts.minStakeWei) / 1e18,
        },
        a,
      );
    } catch (err) {
      log.error("arc copy job failed", { key: a.key, err });
      return "failed";
    }
  },
});
