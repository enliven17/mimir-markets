"use node";

// Mimir Launch, the Solana side of an agent's tick as a Node action (ported from snipad convex/worker/tick.ts): take
// the agent's lease, build its deps (process-cached sources and executor, its own brain), run lib/launch/worker/tick.ts.
// Scheduled per agent by launchSolDb.tickAll. Env: LAUNCH_SOLANA=1, the Privy/RPC env lib/launch/solana/env.ts reads,
// optional HELIUS_API_KEYS (whale source), JUPITER_API_KEY, LAUNCH_RANK_THRESHOLD, LAUNCH_MAX_OPEN.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { byokRouter, type SealedKey } from "../lib/launch/byok";
import { createRanker } from "../lib/launch/engine/rank";
import { platformRouter } from "../lib/launch/llm";
import { createDexScreener } from "../lib/launch/market/dexscreener";
import { createHeliusSource } from "../lib/launch/market/helius";
import { createXSource } from "../lib/launch/market/x";
import { createJupiterPrices, fallbackPrices } from "../lib/launch/market/jupiter";
import type { AgentRow, PositionRow, Ranker, Repo } from "../lib/launch/ports";
import { solanaFromEnv } from "../lib/launch/solana/env";
import { lockOwnMint } from "../lib/launch/solana/locks";
import { heliusClient, heliusKeys } from "../lib/launch/solana/rpc-pool";
import { createConsoleLogger, publicError, type Log } from "../lib/launch/worker/log";
import { tickAgent, type TickDeps } from "../lib/launch/worker/tick";
import { createMirror, type CopyFanout } from "../lib/launch/worker/copy";
import type { AgentView, PositionView } from "./launchSolDb";

const log = createConsoleLogger({ level: process.env.LOG_LEVEL, base: { svc: "launch-sol" } });
const KEY = "HELIUS_KEY";

function build(env: Record<string, string | undefined>) {
  const solana = solanaFromEnv(env, { onRetry: (e: unknown) => log.warn("solana retry", { event: e }) });
  const onError = (source: string, err: unknown) => log.warn("market source error", { source, err: publicError(err) });
  const jupiter = createJupiterPrices({ apiKey: env.JUPITER_API_KEY || undefined, onError });
  const dex = createDexScreener({ onError, solUsd: jupiter.solUsd });
  // The whale source builds URLs with a placeholder key; the client swaps a live one in per request, so a real key
  // never sits in a URL the source could log.
  const helius = heliusKeys(env).length ? heliusClient(env) : null;
  const whales = createHeliusSource({
    apiKey: helius ? KEY : undefined,
    fetch: helius ? (url, init) => helius((k) => url.replace(`api-key=${KEY}`, `api-key=${encodeURIComponent(k)}`), init) : undefined,
    onError,
  });
  // X mentions through an external CLI (snipad's agent-reach / twitter-cli); returns nothing unless AGENT_REACH_BIN is set.
  const x = createXSource({ bin: env.AGENT_REACH_BIN || undefined, args: env.X_SEARCH_ARGS ? (JSON.parse(env.X_SEARCH_ARGS) as string[]) : undefined, query: env.X_QUERY || undefined, onError });
  const threshold = env.LAUNCH_RANK_THRESHOLD ? Number(env.LAUNCH_RANK_THRESHOLD) : undefined;
  return {
    executor: solana.executor,
    sources: { dexscreener: dex.source, helius: whales, x },
    prices: fallbackPrices(jupiter, dex.prices, onError),
    enrich: dex.enrich,
    settings: { threshold: threshold !== undefined && threshold >= 0 && threshold <= 1 ? threshold : undefined, maxOpen: Math.min(20, Math.max(1, Number(env.LAUNCH_MAX_OPEN) || 3)) },
  };
}
let cached: ReturnType<typeof build> | null = null;

const toAgent = (a: AgentView): AgentRow => ({
  id: a.id, name: a.name, ticker: a.ticker, mint: a.mint, owner: a.owner, walletId: a.walletId, wallet: a.wallet,
  status: a.status, config: a.config, risk: a.risk, createdAt: new Date(a.createdAt), ...(a.idle ? { idle: a.idle } : {}),
  reservedLamports: BigInt(a.reservedLamports),
});
const toPosition = (p: PositionView): PositionRow => ({
  id: p.id, agentId: p.agent, mint: p.mint, symbol: p.symbol, tokens: BigInt(p.tokens), decimals: p.decimals,
  costLamports: BigInt(p.costLamports), entryPrice: p.entryPrice, highPrice: p.highPrice, openedAt: new Date(p.openedAt),
});

const SWEEP_ONLY = {
  config: { preset: "trending", sources: [], entry: [], whales: [], trailingStopPct: null, maxHoldMinutes: null, thesis: "", liveView: "public", copyTrade: false },
  risk: { slippageBps: 300, positionPct: 5, stopLossPct: 20, takeProfitPct: 50, maxDailyLossPct: 20 },
} as const;

function convexRepo(ctx: ActionCtx): Repo {
  const aid = (id: string) => id as Id<"launchAgents">;
  const pid = (id: string) => id as Id<"launchPositions">;
  const sell = async (id: string, s: { lamports: bigint; tokens: bigint; reason: string; sig: string }, close: boolean) => {
    await ctx.runMutation(internal.launchSolDb.sell, { positionId: pid(id), close, lamports: s.lamports.toString(), tokens: s.tokens.toString(), reason: s.reason, sig: s.sig });
  };
  return {
    agent: async (id) => {
      const a = await ctx.runQuery(internal.launchSolDb.agent, { id: aid(id) });
      if (!a) return null;
      if (a.config && a.risk) return toAgent(a);
      // Markets-only agent: no strategy, but a kill still needs the sweep (sells nothing, burns its token, returns SOL).
      return a.status === "killed" ? toAgent({ ...a, config: SWEEP_ONLY.config, risk: SWEEP_ONLY.risk }) : null;
    },
    openPositions: async (id) => (await ctx.runQuery(internal.launchSolDb.openPositions, { id: aid(id) })).map(toPosition),
    openPosition: async (p, buy) =>
      toPosition(await ctx.runMutation(internal.launchSolDb.openPosition, {
        agent: aid(p.agentId), mint: p.mint, symbol: p.symbol, tokens: p.tokens.toString(), decimals: p.decimals, costLamports: p.costLamports.toString(),
        entryPrice: p.entryPrice, highPrice: p.highPrice, buy: { lamports: buy.lamports.toString(), reason: buy.reason, sig: buy.sig },
      })),
    closePosition: (id, s) => sell(id, s, true),
    reducePosition: (id, s) => sell(id, s, false),
    setHighPrice: async (id, price) => void (await ctx.runMutation(internal.launchSolDb.setHighPrice, { positionId: pid(id), price })),
    dailyPnl: async (id) => BigInt(await ctx.runQuery(internal.launchSolDb.dailyPnl, { id: aid(id) })),
    logEvent: async (id, kind, text) => void (await ctx.runMutation(internal.launchSolDb.logEvent, { id: aid(id), kind, text })),
    setStatus: async (id, status) => void (await ctx.runMutation(internal.launchSolDb.setStatus, { id: aid(id), status })),
    markSwept: async (id) => void (await ctx.runMutation(internal.launchSolDb.markSwept, { id: aid(id) })),
    setIdle: async (id, s) => void (await ctx.runMutation(internal.launchSolDb.setIdle, { id: aid(id), idle: s })),
    closeOutPools: (id, holdersMinLamports) => ctx.runMutation(internal.launchFeeDb.closeOutPools, { id: aid(id), holdersMinLamports }),
  };
}

/** Copy trading: the agent's fill becomes one job per follower (convex/launchCopyJobs.ts), scheduled, never run here. */
function copyFanout(ctx: ActionCtx): CopyFanout {
  const aid = (id: string) => id as Id<"launchAgents">;
  const sid = (id: string) => id as Id<"launchCopies">;
  return {
    solSubs: (id) => ctx.runQuery(internal.launchCopy.solSubs, { id: aid(id) }),
    holders: (id, mint) => ctx.runQuery(internal.launchCopy.holders, { id: aid(id), mint }),
    schedule: async (j) =>
      void (j.kind === "buy"
        ? await ctx.scheduler.runAfter(0, internal.launchCopyJobs.solBuy, { key: j.key, sub: sid(j.sub), mint: j.mint, slippageBps: j.slippageBps })
        : await ctx.scheduler.runAfter(0, internal.launchCopyJobs.solSell, { key: j.key, sub: sid(j.sub), mint: j.mint, fraction: j.fraction, slippageBps: j.slippageBps })),
  };
}

/**
 * The agent's ranker. On the owner's key a failed call pauses the agent with an event: Mimir's keys never stand in
 * for it silently. Mimir AI failures are just "no trade this tick".
 */
function rankerFor(b: { uid: string; brain: { kind: "mimir" } | SealedKey & { kind: "byok" } }, repo: Repo, agentId: string, l: Log): Ranker {
  if (b.brain.kind !== "byok") return createRanker(platformRouter, { onError: (err) => l.warn("ranker failed", { agentId, err: publicError(err) }) });
  let failed: unknown = null;
  const inner = createRanker(byokRouter(b.uid, b.brain as SealedKey), { onError: (err) => (failed = err) });
  return {
    async rank(a) {
      failed = null;
      const out = await inner.rank(a);
      if (failed) {
        await repo.setStatus(agentId, "paused");
        await repo.logEvent(agentId, "error", `your ${b.brain.kind === "byok" ? (b.brain as SealedKey).provider : ""} key failed (${publicError(failed)}): agent paused. Check the key, then resume.`);
      }
      return out;
    },
  };
}

export const tickOne = internalAction({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }): Promise<string> => {
    if (process.env.MIMIR_BACKEND_OFF === "1" || process.env.LAUNCH_SOLANA !== "1") return "gated";
    const token = await ctx.runMutation(internal.launchSolDb.acquire, { id });
    if (token === null) return "busy";
    try {
      const repo = convexRepo(ctx);
      const [agent, b] = await Promise.all([repo.agent(id), ctx.runQuery(internal.launchSolDb.brain, { id })]);
      if (!agent || !b) return "missing";
      // The executor refuses to sell or move the agent's own token from this wallet.
      lockOwnMint(agent.wallet, agent.mint);
      cached ??= build(process.env);
      const deps: TickDeps = { ...cached, repo, ranker: rankerFor(b as Parameters<typeof rankerFor>[0], repo, id, log), now: Date.now, log, mirror: createMirror(copyFanout(ctx), log) };
      const r = await tickAgent(agent, deps);
      log.debug("ticked", { agentId: id, ...r });
      return r.errors > 0 ? "errors" : "ok";
    } catch (err) {
      // Deps failed to build (bad env) or Convex itself failed; the agent is untouched.
      log.error("tick action failed", { agentId: id, err });
      return "failed";
    } finally {
      await ctx.runMutation(internal.launchSolDb.release, { id, token });
    }
  },
});
