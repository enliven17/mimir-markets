"use node";

// Mimir Launch, the Arc side of an agent's tick: pick the open pools its rules allow, let its brain (Mimir AI or the
// owner's key) give P(side A), stake the best edge at a fraction of Kelly from its own Circle wallet (it pays its own
// gas in USDC). One stake per agent per tick at most. Env: LAUNCH_ARC=1 to run, LAUNCH_ARC_DRY_RUN=1 to decide
// without staking, plus the Circle and LLM keys the council already uses.
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { arcPublicClient } from "../lib/arc/chain";
import { arcConfig } from "../lib/arc/config";
import { LOCK_SECONDS } from "../lib/arc/markets";
import { byokRouter, type SealedKey } from "../lib/launch/byok";
import { platformRouter } from "../lib/launch/llm";
import { judgeMarkets, marketCandidates, pickStake, type MarketRules, type MarketView } from "../lib/launch/markets";
import { executeContract } from "../lib/server/circle-w3s";

const EVERY_MS = 10 * 60_000;
const AGENTS_PER_TICK = 10;
/** Kept in the wallet for gas. */
const GAS_RESERVE_USDC = 0.05;
const usdc = (wei: string | bigint) => Number(BigInt(wei)) / 1e18;

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const e = process.env;
    if (e.MIMIR_BACKEND_OFF === "1" || e.LAUNCH_ARC !== "1") return;
    const cfg = arcConfig({ network: e.ARC_NETWORK, rpcUrl: e.ARC_RPC, mimirV3: e.MIMIR_V3_ADDRESS, mimirPool: e.MIMIR_POOL_ADDRESS, minStake: e.MIMIR_MIN_STAKE });
    const pool = cfg.contracts.mimirPool;
    if (!pool) return;
    const agents = await ctx.runMutation(internal.launch.claimMarketAgents, { now: Date.now(), everyMs: EVERY_MS, max: AGENTS_PER_TICK });
    if (!agents.length) return;
    const nowS = Math.floor(Date.now() / 1000);
    const markets: MarketView[] = (await ctx.runQuery(internal.arc.openMarkets, { closesAfter: nowS + LOCK_SECONDS })).map((m) => ({
      kind: m.kind, marketId: m.marketId, question: m.question, labelA: m.labelA, labelB: m.labelB, category: m.category,
      deadline: m.deadline, lockAt: m.lockAt ?? 0, usdcA: usdc(m.stakeA), usdcB: usdc(m.stakeB), status: "open",
    }));
    const client = arcPublicClient(cfg);
    let staked = false;

    for (const a of agents) {
      const say = (kind: string, text: string, pause?: boolean) => ctx.runMutation(internal.launch.note, { agent: a.id, kind, text, pause });
      try {
        const rules = a.markets.rules as MarketRules;
        const candidates = marketCandidates(markets, rules, new Set(a.held), nowS);
        if (!candidates.length) continue;
        const balance = usdc(await client.getBalance({ address: a.arc.address as `0x${string}` }));
        const budget = Math.min(a.markets.budgetUsdc - a.openUsdc, balance - GAS_RESERVE_USDC);
        if (budget < 0.1) continue;
        const router = a.brain.kind === "byok" ? byokRouter(a.uid, a.brain as SealedKey) : platformRouter;
        const judged = await judgeMarkets(router, a.thesis, candidates, nowS);
        if (!judged.size) {
          // An owner's key that answers nothing pauses the agent; Mimir's keys never stand in for it silently.
          if (a.brain.kind === "byok") await say("error", "your API key gave no answer: agent paused. Check the key, then resume.", true);
          continue;
        }
        const pick = pickStake(judged, candidates, rules, budget);
        if (!pick) {
          await say("hold", `read ${judged.size} market${judged.size > 1 ? "s" : ""}, no edge worth a stake`);
          continue;
        }
        const label = pick.side === 1 ? pick.market.labelA : pick.market.labelB;
        const amount = pick.stakeUsdc.toFixed(2);
        const why = `${Math.round(pick.p * 100)}% vs pool ${Math.round((pick.p - pick.edge) * 100)}%: ${pick.why}`.slice(0, 200);
        if (e.LAUNCH_ARC_DRY_RUN === "1") {
          await say("hold", `[dry run] would stake ${amount} USDC on "${label}" in #${pick.market.marketId}. ${why}`);
          continue;
        }
        const tx = await executeContract({ walletId: a.arc.walletId, contractAddress: pool, abiFunctionSignature: "stake(uint256,uint8,address)", abiParameters: [BigInt(pick.market.marketId), pick.side, "0x0000000000000000000000000000000000000000"], amount });
        staked = true;
        await ctx.runMutation(internal.launch.recordStake, {
          agent: a.id, kind: pick.market.kind, marketId: pick.market.marketId, side: pick.side, usdc: Number(amount), p: pick.p, edge: pick.edge, why: pick.why, tx,
          text: `staked ${amount} USDC on "${label}" (${pick.market.question.slice(0, 80)}). ${why}`,
        });
        // Counted at once so the next agent sees the moved pool.
        pick.market[pick.side === 1 ? "usdcA" : "usdcB"] += Number(amount);
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200);
        console.warn(`[launch-arc] ${a.id}: ${msg}`);
        await say("error", `market step failed: ${msg}`).catch(() => undefined);
      }
    }
    if (staked) await ctx.scheduler.runAfter(0, internal.arcSync.sync, {});
  },
});
