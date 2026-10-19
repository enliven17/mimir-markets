"use node";

// Mimir Launch, the Robinhood Chain side of an agent's tick (venue "robinhood"): the same engine and Convex repo as
// the Solana tick (convex/launchSol.ts), with the Pons executor (lib/launch/robinhood) and GeckoTerminal sources.
// Amounts cross the engine in gwei; event text says ETH. Its own token's creator fees are claimed into its wallet
// hourly (they become bankroll) and once more before a shutdown sweep. Scheduled per agent by launchSolDb.tickAll.
// Env: LAUNCH_ROBINHOOD=1, lib/launch/robinhood/env.ts, LAUNCH_RANK_THRESHOLD, LAUNCH_MAX_OPEN.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Repo } from "../lib/launch/ports";
import { robinhoodFromEnv } from "../lib/launch/robinhood/env";
import { createPonsSources } from "../lib/launch/robinhood/market";
import { createConsoleLogger, publicError } from "../lib/launch/worker/log";
import { tickAgent, type TickDeps } from "../lib/launch/worker/tick";
import { convexRepo, rankerFor } from "./launchSol";

const log = createConsoleLogger({ level: process.env.LOG_LEVEL, base: { svc: "launch-rh" } });
const CLAIM_EVERY_MS = 60 * 60_000;
/** 0.001 ETH in gwei: the smallest trade worth its gas and the curve fee. */
const MIN_TRADE_GWEI = 1_000_000n;

function build(env: Record<string, string | undefined>) {
  const rh = robinhoodFromEnv(env);
  const pons = createPonsSources({ onError: (source, err) => log.warn("market source error", { source, err: publicError(err) }) });
  const threshold = env.LAUNCH_RANK_THRESHOLD ? Number(env.LAUNCH_RANK_THRESHOLD) : undefined;
  return {
    rh,
    deps: {
      executor: rh.executor,
      sources: { pumpfun: pons.curve, dexscreener: pons.graduated },
      prices: { prices: rh.executor.prices },
      enrich: rh.executor.onlyTradable,
      settings: {
        threshold: threshold !== undefined && threshold >= 0 && threshold <= 1 ? threshold : undefined,
        maxOpen: Math.min(20, Math.max(1, Number(env.LAUNCH_MAX_OPEN) || 3)),
        minTradeLamports: MIN_TRADE_GWEI,
      },
    },
  };
}
let cached: ReturnType<typeof build> | null = null;

/** The engine writes "SOL"; on this chain the coin is ETH (amounts are already in gwei, so the numbers hold). */
const inEth = (repo: Repo): Repo => {
  const { closeOutPools: _noPools, ...rest } = repo;
  return { ...rest, logEvent: (id, kind, text) => repo.logEvent(id, kind, text.replace(/\bSOL\b/g, "ETH")) };
};

export const tickOne = internalAction({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }): Promise<string> => {
    if (process.env.MIMIR_BACKEND_OFF === "1" || process.env.LAUNCH_ROBINHOOD !== "1") return "gated";
    const token = await ctx.runMutation(internal.launchSolDb.acquire, { id });
    if (token === null) return "busy";
    try {
      const repo = inEth(convexRepo(ctx));
      const [agent, b, fees] = await Promise.all([repo.agent(id), ctx.runQuery(internal.launchSolDb.brain, { id }), ctx.runQuery(internal.launchSolDb.feesClaimedAt, { id })]);
      if (!agent || !b) return "missing";
      cached ??= build(process.env);
      const { rh, deps: base } = cached;
      // Its own token's fees into its wallet: hourly, and always before a shutdown sweep sends the wallet home.
      if (agent.mint && (agent.status === "killed" || Date.now() - (fees ?? 0) > CLAIM_EVERY_MS)) {
        try {
          const claimed = await rh.executor.claimCreatorFees({ walletId: agent.walletId, wallet: agent.wallet, token: agent.mint });
          if (claimed) await repo.logEvent(id, "rules", `claimed ${(Number(claimed.wei) / 1e18).toFixed(5)} ETH of $${agent.ticker} creator fees (${claimed.sig.slice(0, 10)}…)`);
          await ctx.runMutation(internal.launchSolDb.markFeesClaimed, { id });
        } catch (err) {
          log.warn("creator fee claim failed", { agentId: id, err: publicError(err) });
        }
      }
      const deps: TickDeps = { ...base, repo, ranker: rankerFor(b as Parameters<typeof rankerFor>[0], repo, id, log), now: Date.now, log };
      const r = await tickAgent(agent, deps);
      log.debug("ticked", { agentId: id, ...r });
      return r.errors > 0 ? "errors" : "ok";
    } catch (err) {
      log.error("tick action failed", { agentId: id, err });
      return "failed";
    } finally {
      await ctx.runMutation(internal.launchSolDb.release, { id, token });
    }
  },
});
