"use node";

// Mimir Launch, the market side of an agent's tick, on every enabled market chain its rules allow (Base and Arc by
// default): pick the open pools its rules allow on that chain, let its brain (Mimir AI or the owner's key) give
// P(side A), stake the best edge at a fraction of Kelly from its own Circle wallet on that chain. At most one stake per
// agent per chain per tick.
//   Arc   its Arc wallet; gas in USDC (a small reserve stays in the wallet).
//   Base  its Base wallet (made here on first use when it has none: needs CIRCLE_WALLET_SET_ID in the Convex env);
//         approve + stake; gas in ETH, which the owner or Mimir sends it (no gas station). No ETH = no Base stake.
// The budget (markets.budgetUsdc) counts what is out on all chains together.
// Env: LAUNCH_ARC=1 to run, LAUNCH_ARC_DRY_RUN=1 to decide without staking, plus the Circle and LLM keys the council uses.
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { indexToUsd, usdToIndex } from "../lib/chains/amounts";
import { circleBlockchain } from "../lib/chains/house";
import { serverMarketChains, type MarketChain, type MarketChainId } from "../lib/chains/registry";
import { LOCK_SECONDS } from "../lib/arc/markets";
import { byokRouter, type SealedKey } from "../lib/launch/byok";
import { platformRouter } from "../lib/launch/llm";
import { judgeMarkets, marketCandidates, pickStake, playsChain, type MarketRules, type MarketView } from "../lib/launch/markets";
import { circleStake, walletGasWei, walletUsdcWei } from "../lib/server/chain-circle";
import { createWallets } from "../lib/server/circle-w3s";
import { copyArcStake } from "../lib/launch/arc-copy";
import { launchCopyKey } from "../lib/launch/copy-key";
import { createConsoleLogger } from "../lib/launch/log";

const copyLog = createConsoleLogger({ level: process.env.LOG_LEVEL, base: { svc: "launch-copy" } });

const EVERY_MS = 10 * 60_000;
const AGENTS_PER_TICK = 10;
/** Kept in the wallet for gas where gas is USDC (Arc). */
const GAS_RESERVE_USDC = 0.05;
const usdc = (wei: string | bigint) => Number(BigInt(wei)) / 1e18;

/** The agent's wallet on a chain: Arc from creation; Base made on first use (null when it cannot be made now). */
async function walletOn(
  ctx: ActionCtx,
  cfg: MarketChain,
  a: { id: Id<"launchAgents">; slug: string; arc?: { walletId: string; address: string }; base: { walletId: string; address: string } | null },
): Promise<{ walletId: string; address: string } | null> {
  if (cfg.id === "arc") return a.arc ?? null;
  if (a.base) return a.base;
  if (!process.env.CIRCLE_WALLET_SET_ID?.trim()) return null;
  const [w] = await createWallets([a.slug], circleBlockchain("base", cfg.network), "mimir-launch");
  const stored = await ctx.runMutation(internal.launch.setBaseWallet, { id: a.id, base: { walletId: w.id, address: w.address } });
  a.base = stored;
  return stored;
}

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.marketDeployment.check, {});
    const e = process.env;
    if (e.MIMIR_BACKEND_OFF === "1" || e.LAUNCH_ARC !== "1") return;
    const registry = serverMarketChains(e);
    const chains = registry.enabled.filter((c) => registry.chains[c].contracts.mimirPool);
    if (!chains.length) return;
    const agents = await ctx.runMutation(internal.launch.claimMarketAgents, { now: Date.now(), everyMs: EVERY_MS, max: AGENTS_PER_TICK });
    if (!agents.length) return;
    const nowS = Math.floor(Date.now() / 1000);
    const marketsOf = new Map<MarketChainId, MarketView[]>();
    for (const c of chains) {
      marketsOf.set(
        c,
        (await ctx.runQuery(internal.arc.openMarkets, { closesAfter: nowS + LOCK_SECONDS, chain: c })).map((m) => ({
          chain: c, kind: m.kind, marketId: m.marketId, question: m.question, labelA: m.labelA, labelB: m.labelB, category: m.category,
          deadline: m.deadline, lockAt: m.lockAt ?? 0, usdcA: usdc(m.stakeA), usdcB: usdc(m.stakeB), status: "open",
        })),
      );
    }
    const staked = new Set<MarketChainId>();

    for (const a of agents) {
      const say = (kind: string, text: string, pause?: boolean) => ctx.runMutation(internal.launch.note, { agent: a.id, kind, text, pause });
      const rules = a.markets.rules as MarketRules;
      let openUsdc = a.openUsdc;
      const agent = { id: a.id, slug: a.slug, arc: a.arc, base: a.base };
      for (const c of chains) {
        if (!playsChain(rules, c)) continue;
        const cfg = registry.chains[c];
        try {
          const candidates = marketCandidates(marketsOf.get(c) ?? [], rules, new Set(a.held), nowS);
          if (!candidates.length) continue;
          const wallet = await walletOn(ctx, cfg, agent);
          if (!wallet) continue;
          const native = cfg.gas.symbol === "USDC";
          const [usdcWei, gasWei] = await Promise.all([walletUsdcWei(cfg, wallet.address), native ? Promise.resolve(1n) : walletGasWei(cfg, wallet.address)]);
          if (gasWei === 0n) continue; // Base: no ETH for gas yet
          const balance = indexToUsd(usdcWei) - (native ? GAS_RESERVE_USDC : 0);
          const budget = Math.min(a.markets.budgetUsdc - openUsdc, balance);
          if (budget < 0.1) continue;
          // Mimir's keys never stand in for an owner's key. A key the provider refuses (401/403) pauses the agent; any
          // other failure (rate limit, timeout) is just no stake this tick.
          let keyError: string | null = null;
          const base = a.brain.kind === "byok" ? byokRouter(a.uid, a.brain as SealedKey) : platformRouter;
          const router: typeof base = {
            completeJson: (o, parse) => base.completeJson(o, parse).catch((err: unknown) => {
              keyError = err instanceof Error ? err.message : String(err);
              throw err;
            }),
          };
          const judged = await judgeMarkets(router, a.thesis, candidates, nowS);
          if (!judged.size) {
            const refused = a.brain.kind === "byok" && keyError !== null && / (401|403)/.test(keyError);
            if (refused) {
              await say("error", "your API key was refused: agent paused. Check the key, then resume.", true);
              break;
            }
            continue;
          }
          const pick = pickStake(judged, candidates, rules, budget, indexToUsd(cfg.contracts.minStakeWei));
          if (!pick) {
            await say("hold", `read ${judged.size} ${cfg.label} market${judged.size > 1 ? "s" : ""}, no edge worth a stake`);
            continue;
          }
          const label = pick.side === 1 ? pick.market.labelA : pick.market.labelB;
          const amount = pick.stakeUsdc.toFixed(2);
          const why = `${Math.round(pick.p * 100)}% vs pool ${Math.round((pick.p - pick.edge) * 100)}%: ${pick.why}`.slice(0, 200);
          if (e.LAUNCH_ARC_DRY_RUN === "1") {
            await say("hold", `[dry run] would stake ${amount} USDC on "${label}" in ${cfg.label} #${pick.market.marketId}. ${why}`);
            continue;
          }
          const tx = await circleStake(cfg, wallet, { kind: "pool", marketId: pick.market.marketId, side: pick.side, wei: usdToIndex(Number(amount)) });
          staked.add(c);
          openUsdc += Number(amount);
          await ctx.runMutation(internal.launch.recordStake, {
            agent: a.id, chain: c, kind: pick.market.kind, marketId: pick.market.marketId, side: pick.side, usdc: Number(amount), p: pick.p, edge: pick.edge, why: pick.why, tx,
            text: `staked ${amount} USDC on "${label}" on ${cfg.label} (${pick.market.question.slice(0, 80)}). ${why}`,
          });
          // Counted at once so the next agent sees the moved pool.
          pick.market[pick.side === 1 ? "usdcA" : "usdcB"] += Number(amount);
          // Followers copying its stakes do the same from their own copy wallets on this chain.
          await copyArcStake(ctx, copyLog, launchCopyKey(a.slug), pick.market, pick.side, tx);
        } catch (err) {
          const msg = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200);
          console.warn(`[launch-arc] ${a.id} ${c}: ${msg}`);
          await say("error", `${cfg.label} market step failed: ${msg}`).catch(() => undefined);
        }
      }
    }
    for (const c of staked) await ctx.scheduler.runAfter(0, internal.arcSync.sync, { chain: c });
  },
});
