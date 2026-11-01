"use node";

// Mimir Launch: one agent opens one market, if its owner turned that on (convex/launchMarketsDb.ts schedules it).
// The brain drafts it; lib/launch/agent-markets.ts holds it to the house creator's bar; the pool opens from the agent's
// own Circle wallet with its seed stake on every enabled chain it plays and can fund (Base: USDC + ETH for gas; Arc:
// USDC), and the copies are linked (lib/chains/linked.ts: one page link, one oracle decision). A chain it could not
// open on gets a house twin from the reconciler (convex/arcTwins.ts). Under the agent lease,
// so it never overlaps a tick spending from the same agent. LAUNCH_ARC_DRY_RUN=1 drafts and checks without opening.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { signatureOf } from "../agents/market-creator/dedupe";
import { indexToUsd } from "../lib/chains/amounts";
import { pairKeyOf } from "../lib/chains/linked";
import { serverMarketChains, type MarketChainId } from "../lib/chains/registry";
import { circleCreatePool, createdMarketId, walletGasWei, walletUsdcWei } from "../lib/server/chain-circle";
import { espnResult } from "../lib/espn";
import { agentDraftProblem, buildAgentMarketPrompt, parseAgentDraft } from "../lib/launch/agent-markets";
import { byokRouter, type SealedKey } from "../lib/launch/byok";
import { platformRouter } from "../lib/launch/llm";
/** Kept in the wallet for gas where gas is USDC (Arc). */
const GAS_RESERVE_USDC = 0.05;

export const createOne = internalAction({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }) => {
    const e = process.env;
    if (e.MIMIR_BACKEND_OFF === "1" || e.LAUNCH_ARC !== "1" || e.LAUNCH_AGENT_MARKETS !== "1") return;
    const registry = serverMarketChains(e);
    if (!registry.enabled.length) return;
    const lease = await ctx.runMutation(internal.launchAgentsDb.acquire, { id });
    if (lease === null) return;
    const say = (kind: string, text: string, pause?: boolean) => ctx.runMutation(internal.launch.note, { agent: id, kind, text, pause });
    try {
      const a = await ctx.runQuery(internal.launchMarketsDb.forCreate, { id });
      if (!a) return;
      const nowS = Math.floor(Date.now() / 1000);
      const open = await ctx.runQuery(internal.arc.openMarkets, { closesAfter: nowS });

      // Mimir's keys never stand in for an owner's key; a refused key pauses the agent, anything else waits an hour.
      let keyError: string | null = null;
      const router = a.brain.kind === "byok" ? byokRouter(a.uid, a.brain as SealedKey) : platformRouter;
      const reply = await router
        .completeJson(buildAgentMarketPrompt(a.thesis, a.categories, open.map((m) => m.question), nowS), (x) => x)
        .catch((err: unknown) => ((keyError = err instanceof Error ? err.message : String(err)), null));
      if (!reply) {
        if (a.brain.kind === "byok" && keyError !== null && / (401|403)/.test(keyError)) await say("error", "your API key was refused: agent paused. Check the key, then resume.", true);
        return;
      }
      const draft = parseAgentDraft(reply.data);
      if (!draft) return void (await say("hold", "drafted a market the checks could not read; not opened"));

      let kickoff: number | null | undefined;
      if (draft.category === "sports") {
        const r = await espnResult(draft.resolutionUrl);
        kickoff = r && !r.completed && Number.isFinite(r.startAt) ? r.startAt : null;
      }
      const problem = agentDraftProblem(draft, {
        nowS,
        categories: a.categories,
        open: open.map((m) => signatureOf({ category: m.category, question: m.question, resolutionUrl: m.resolutionUrl }, `${m.kind} #${m.marketId}`)),
        kickoff,
      });
      if (problem) return void (await say("hold", `drafted "${draft.question.slice(0, 90)}" but did not open it: ${problem}`));

      // Where it opens: every enabled chain its rules allow, where it has a wallet, the seed and gas.
      const wallets: Record<MarketChainId, { walletId: string; address: string } | null> = { arc: a.arc, base: a.base };
      const targets = [];
      let budgetLeft = a.budgetUsdc - a.openUsdc;
      for (const c of registry.enabled) {
        const cfg = registry.chains[c];
        const w = wallets[c];
        if (!w || !cfg.contracts.mimirPool || (a.chains.length && !a.chains.includes(c))) continue;
        // Its seed stake is the pool minimum, inside its budget and (Arc) above its gas reserve.
        const seedWei = cfg.contracts.minStakeWei;
        const seed = indexToUsd(seedWei);
        const native = cfg.gas.symbol === "USDC";
        const [usdc, gas] = await Promise.all([walletUsdcWei(cfg, w.address), native ? Promise.resolve(1n) : walletGasWei(cfg, w.address)]);
        if (gas === 0n || budgetLeft < seed || indexToUsd(usdc) - (native ? GAS_RESERVE_USDC : 0) < seed) continue;
        budgetLeft -= seed;
        targets.push({ cfg, w, seed, seedWei });
      }
      if (!targets.length) return void (await say("hold", `wanted to open "${draft.question.slice(0, 90)}" but has no funded wallet for the seed stake (USDC, and ETH for gas on Base)`));
      if (e.LAUNCH_ARC_DRY_RUN === "1") return void (await say("hold", `[dry run] would open "${draft.question.slice(0, 120)}" (${draft.category}) on ${targets.map((t) => t.cfg.label).join(" and ")}, closing ${new Date(draft.deadline * 1000).toISOString()}`));

      // Linked whenever more than one chain is enabled: a chain the agent cannot open on (rules, funds, a failure) gets
      // its twin from the house creator later (convex/arcTwins.ts), under this pairKey.
      const pairKey = registry.enabled.length > 1 ? pairKeyOf(`agent:${a.slug}`, draft) : undefined;
      for (const { cfg, w, seed, seedWei } of targets) {
        try {
          const tx = await circleCreatePool(cfg, w, draft, seedWei);
          await ctx.runMutation(internal.launchMarketsDb.record, {
            agent: id, chain: cfg.id, ...(pairKey ? { pairKey } : {}), question: draft.question, category: draft.category, resolutionUrl: draft.resolutionUrl, deadline: draft.deadline,
            side: draft.side, seedUsdc: seed, tx, why: draft.why,
          });
          if (pairKey) {
            const marketId = await createdMarketId(cfg, "pool", tx).catch(() => null);
            if (marketId !== null) await ctx.runMutation(internal.arc.link, { pairKey, chain: cfg.id, kind: "pool", marketId });
          }
          await ctx.scheduler.runAfter(0, internal.arcSync.sync, { chain: cfg.id });
        } catch (err) {
          const msg = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200);
          await say("error", `opening the market on ${cfg.label} failed: ${msg}`).catch(() => undefined);
        }
      }
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200);
      console.warn(`[launch-markets] ${id}: ${msg}`);
      await say("error", `opening a market failed: ${msg}`).catch(() => undefined);
    } finally {
      await ctx.runMutation(internal.launchAgentsDb.release, { id, token: lease });
    }
  },
});
