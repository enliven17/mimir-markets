/**
 * Mimir Launch copy trading, the Arc side wired to Convex: after an agent (or a council persona) stakes on a pool,
 * each follower's Circle copy wallet stakes the same side (lib/launch/worker/copy.ts mirrorArcStake). Node only
 * (Circle). Relative imports: the Convex actions import this.
 */
import type { GenericActionCtx, GenericDataModel } from "convex/server";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { arcPublicClient } from "../arc/chain";
import type { ArcConfig } from "../arc/config";
import { executeContract } from "../server/circle-w3s";
import { holdsMimir } from "./copy-gate";
import { mirrorArcStake } from "./worker/copy";
import type { Log } from "./worker/log";

const ZERO = "0x0000000000000000000000000000000000000000";

export function copyArcStake(
  ctx: Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation">,
  cfg: ArcConfig,
  log: Log,
  agentSlug: string,
  market: { kind: "vs" | "pool"; marketId: number },
  side: number,
): Promise<number> {
  const pool = cfg.contracts.mimirPool;
  if (!pool) return Promise.resolve(0);
  const client = arcPublicClient(cfg);
  return mirrorArcStake(
    {
      subs: () => ctx.runQuery(internal.launchCopy.arcSubs, { agent: agentSlug }),
      pauseForGate: async (id) => void (await ctx.runMutation(internal.launchCopy.pauseForGate, { sub: id as Id<"launchCopies"> })),
      balanceUsdc: async (wallet) => Number(await client.getBalance({ address: wallet as `0x${string}` })) / 1e18,
      stake: ({ walletId, marketId, side: s, amountUsdc }) =>
        executeContract({ walletId, contractAddress: pool, abiFunctionSignature: "stake(uint256,uint8,address)", abiParameters: [BigInt(marketId), s, ZERO], amount: amountUsdc.toFixed(2) }),
      holds: holdsMimir,
      log,
      minStakeUsdc: Number(cfg.contracts.minStakeWei) / 1e18,
    },
    market,
    side,
  );
}
