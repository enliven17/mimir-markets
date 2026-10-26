"use node";

// Mimir Launch copy trading, one follower at a time (lib/launch/worker/copy.ts). The agent ticks (launchSol,
// launchArc, arcCouncil) only schedule these, one per follower and agent fill, so a slow follower never holds up the
// agent or the others and a long fan-out never runs past an action's time limit. Each job runs once (its key).
// Also here: the follower's drain, and the settling of copy buys whose outcome was never recorded.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { arcPublicClient } from "../lib/arc/chain";
import { arcConfig } from "../lib/arc/config";
import { holdsMimir } from "../lib/launch/copy-gate";
import { solanaFromEnv } from "../lib/launch/solana/env";
import { fetchConfirmedTx, settleSignature, walletDeltas } from "../lib/launch/solana/tx";
import { drainCopies, reconcileCopyBuy, runArcCopy, runSolBuy, runSolSell, type CopyJobStore } from "../lib/launch/worker/copy";
import { createConsoleLogger } from "../lib/launch/worker/log";
import { executeContract } from "../lib/server/circle-w3s";
import { createDexScreener } from "../lib/launch/market/dexscreener";
import { createJupiterPrices } from "../lib/launch/market/jupiter";

const log = createConsoleLogger({ level: process.env.LOG_LEVEL, base: { svc: "launch-copy" } });
const ZERO = "0x0000000000000000000000000000000000000000";
const gated = () => process.env.MIMIR_BACKEND_OFF === "1";

let solana: ReturnType<typeof solanaFromEnv> | null = null;
const sol = () => (solana ??= solanaFromEnv(process.env, { onRetry: (e: unknown) => log.warn("solana retry", { event: e }) }));
const arc = () => arcConfig({ network: process.env.ARC_NETWORK, rpcUrl: process.env.ARC_RPC, mimirV3: process.env.MIMIR_V3_ADDRESS, mimirPool: process.env.MIMIR_POOL_ADDRESS, minStake: process.env.MIMIR_MIN_STAKE });

function store(ctx: ActionCtx) {
  const sid = (id: string) => id as Id<"launchCopies">;
  const s: CopyJobStore = {
    claim: (key, sub, kind) => ctx.runMutation(internal.launchCopy.claim, { key, sub: sid(sub), kind }),
    solSub: async (id) => {
      const s = await ctx.runQuery(internal.launchCopy.solSub, { sub: sid(id) });
      return s && { ...s, maxPerTradeLamports: BigInt(s.maxPerTradeLamports) };
    },
    held: async (id, mint) => BigInt(await ctx.runQuery(internal.launchCopy.held, { sub: sid(id), mint })),
    buySigned: async (key, mint, sig, lastValidBlockHeight) => void (await ctx.runMutation(internal.launchCopy.buySigned, { key, mint, sig, lastValidBlockHeight })),
    addFill: async (key, sub, mint, tokens, cost) => void (await ctx.runMutation(internal.launchCopy.addFill, { key, sub: sid(sub), mint, tokens: tokens.toString(), costLamports: cost.toString() })),
    settleSell: async (sub, mint, held, left, receipt) => void (await ctx.runMutation(internal.launchCopy.settleSell, { sub: sid(sub), mint, held: held.toString(), left: left.toString(), ...(receipt ? { receipt: { sig: receipt.sig, proceeds: receipt.proceeds.toString() } } : {}) })),
    reserveRisk: async (job, amount) => {
      const sub = await ctx.runQuery(internal.launchCopy.solSub, { sub: sid(job.sub) });
      if (!sub) return "Copy wallet unavailable.";
      const prices = createJupiterPrices({ apiKey: process.env.JUPITER_API_KEY, ttlMs: 0 });
      await prices.prices([job.mint]);
      const dex = createDexScreener({ solUsd: prices.solUsd, pairsTtlMs: 0 });
      const quote = (await dex.source.lookup([job.mint])).get(job.mint);
      const solUsd = prices.solUsd();
      return await ctx.runMutation(internal.copyRisk.reserve, { key: job.key, sub: sid(job.sub), mint: job.mint, lamports: amount.toString(), quote: {
        referencePrice: job.referencePrice, signalAt: job.signalAt, price: quote?.priceSol ?? 0,
        liquiditySol: solUsd ? (quote?.metrics.liquidityUsd ?? 0) / solUsd : 0, checkedAt: Date.now(),
      } });
    },
    finish: async (key, status, note) => void (await ctx.runMutation(internal.launchCopy.finish, { key, status, ...(note ? { note } : {}) })),
    pauseForGate: async (sub) => void (await ctx.runMutation(internal.launchCopy.pauseForGate, { sub: sid(sub) })),
  };
  return { ...s, arcSub: (id: string) => ctx.runQuery(internal.launchCopy.arcSub, { sub: sid(id) }) };
}

export const solBuy = internalAction({
  args: { key: v.string(), sub: v.id("launchCopies"), mint: v.string(), slippageBps: v.number(), referencePrice: v.optional(v.number()), signalAt: v.optional(v.number()) },
  handler: async (ctx, a): Promise<string> => {
    if (gated()) return "gated";
    try {
      return await runSolBuy(store(ctx), sol().executor, holdsMimir, log, { kind: "buy", ...a });
    } catch (err) {
      log.error("copy buy job failed", { key: a.key, err });
      return "failed";
    }
  },
});

export const solSell = internalAction({
  args: { key: v.string(), sub: v.id("launchCopies"), mint: v.string(), fraction: v.number(), slippageBps: v.number() },
  handler: async (ctx, a): Promise<string> => {
    if (gated()) return "gated";
    try {
      return await runSolSell(store(ctx), sol().executor, log, { kind: "sell", ...a });
    } catch (err) {
      log.error("copy sell job failed", { key: a.key, err });
      return "failed";
    }
  },
});

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
          store: store(ctx),
          balanceUsdc: async (wallet) => Number(await client.getBalance({ address: wallet as `0x${string}` })) / 1e18,
          stake: ({ walletId, marketId, side, amountUsdc }) =>
            executeContract({ walletId, contractAddress: pool, abiFunctionSignature: "stake(uint256,uint8,address)", abiParameters: [BigInt(marketId), side, ZERO], amount: amountUsdc.toFixed(2) }),
          holds: holdsMimir,
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

/** The follower's drain: sell what the Solana copy wallet holds of every copied mint (its SOL is then withdrawable). */
export const drain = internalAction({
  args: { sub: v.id("launchCopies") },
  handler: async (ctx, { sub }): Promise<string> => {
    if (gated()) return "gated";
    const s = await ctx.runQuery(internal.launchCopy.solSub, { sub });
    if (!s) return "no wallet";
    const mints = await ctx.runQuery(internal.launchCopy.copiedMints, { sub });
    const ex = sol().executor;
    try {
      return `sold ${await drainCopies(store(ctx), { sell: ex.sell, tokenBalance: ex.tokenBalance }, s, mints)}`;
    } catch (err) {
      log.warn("copy drain failed", { sub, err });
      return "failed";
    }
  },
});

/** Copy buys signed but never recorded: settled by signature (lib/launch/worker/copy.ts reconcileCopyBuy). */
export const reconcileBuys = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    if (gated()) return "gated";
    const rows = await ctx.runQuery(internal.launchCopy.unsettledBuys, { before: Date.now() - 10 * 60_000 });
    if (!rows.length) return "none";
    const s = sol();
    const ep = s.sticky.pickEndpoint();
    if (!ep) return "no endpoint";
    const st = store(ctx);
    let done = 0;
    for (const r of rows) {
      try {
        const out = await reconcileCopyBuy(
          r,
          async (sig, lvbh) => (await settleSignature(ep.connection, ep.witnesses, sig, lvbh)).state,
          async (sig) => {
            const d = walletDeltas(await fetchConfirmedTx(ep.connection, sig), r.wallet, r.mint);
            return { tokens: d.tokens > 0n ? d.tokens : 0n, lamports: d.lamports < 0n ? -d.lamports : 0n };
          },
          st,
        );
        if (out !== "open") done++;
      } catch (err) {
        log.warn("copy buy reconcile failed", { key: r.key, err });
      }
    }
    return `settled ${done}/${rows.length}`;
  },
});
