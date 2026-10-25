"use node";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { createDexScreener } from "../lib/launch/market/dexscreener";
import { createJupiterPrices } from "../lib/launch/market/jupiter";
import { createPonsSources } from "../lib/launch/robinhood/market";
import { passingCandidates } from "../lib/launch/engine/rules";
import { createRanker } from "../lib/launch/engine/rank";
import { judgeMarkets, marketCandidates } from "../lib/launch/markets";
import { demoEvent, tradeDemo, stakeDemo } from "../lib/demo/engine";
import { recordDemoPrices } from "../lib/demo/charts";
import { demoRouter } from "../lib/demo/router";
import { DEMO, type DemoFeed } from "../lib/demo/types";

export const tick = internalAction({
  args: {}, handler: async (ctx) => {
    if (process.env.MIMIR_BACKEND_OFF === "1" || process.env.DEMO_ENABLED !== "1") return;
    await ctx.runMutation(internal.demo.ensureShowcase, {});
    const agents = await ctx.runMutation(internal.demo.claimTick, {});
    if (!agents.length) return;
    const feed = await ctx.runMutation(internal.demo.feed, {});
    let snapshot: DemoFeed | null = feed.snapshot;
    if (feed.refresh) {
      // Shared across all guests, persisted for five minutes. Never use paid wallet/social or trading APIs.
      const prices = createJupiterPrices({ ttlMs: DEMO.tickMs, timeoutMs: 8_000 });
      if (feed.solana) await prices.prices([]);
      const dex = createDexScreener({ maxCandidates: 30, solUsd: prices.solUsd, timeoutMs: 8_000 });
      const pons = createPonsSources({ ttlMs: DEMO.tickMs });
      const [tokens, held, curves, graduated, markets] = await Promise.all([
        feed.solana ? dex.source.candidates({ whales: [] }) : [], feed.solana ? dex.lookup(feed.held) : new Map(),
        feed.robinhood ? pons.curve.candidates({ whales: [] }) : [], feed.robinhood ? pons.graduated.candidates({ whales: [] }) : [],
        ctx.runQuery(internal.arc.openMarkets, { closesAfter: Math.floor(Date.now() / 1000) + 180 }),
      ]);
      const solana = new Map(tokens.map((c) => [c.mint, c]));
      for (const [mint, c] of held) if (!solana.has(mint)) solana.set(mint, { ...c, source: "dexscreener" });
      snapshot = { at: Date.now(), solana: [...solana.values()], robinhood: [...curves, ...graduated],
        markets: markets.filter((m) => m.kind === "pool").slice(0, 100).map((m) => ({ kind: m.kind, marketId: m.marketId,
          question: m.question, labelA: m.labelA, labelB: m.labelB, category: m.category, deadline: m.deadline,
          lockAt: m.lockAt ?? 0, usdcA: Number(BigInt(m.stakeA)) / 1e18, usdcB: Number(BigInt(m.stakeB)) / 1e18, status: m.status })) };
      // Remove undefined fields before passing values into Convex.
      snapshot = JSON.parse(JSON.stringify(snapshot)) as DemoFeed;
      await ctx.runMutation(internal.demo.saveFeed, { token: feed.token, snapshot });
    }
    // An expired snapshot can never create a fill or a new decision.
    if (!snapshot || Date.now() - snapshot.at > DEMO.tickMs + 60_000) return;
    for (const { agent, version, stakes } of agents) {
      try {
        const now = Date.now();
        const candidates = agent.chain === "robinhood" ? snapshot.robinhood : snapshot.solana;
        let aiIssue = "";
        const router = demoRouter(async () => {
          const allowed = await ctx.runMutation(internal.demo.claimAi, { id: agent.id as Id<"demoAgents">, version });
          if (!allowed) aiIssue = "Preview AI allowance reached. New entries are waiting; exit rules remain active.";
          return allowed;
        });
        const t = agent.trading;
        const passing = t.enabled && t.config && agent.status === "live" && agent.state.positions.length < DEMO.maxOpen
          ? passingCandidates(candidates.filter((c) => t.config!.sources.includes(c.source) && !agent.state.positions.some((p) => p.mint === c.mint)), t.config.entry) : [];
        const scores = passing.length ? await createRanker(router, { maxCandidates: 6, onError: () => { aiIssue ||= "Preview AI is unavailable. New entries are waiting; exit rules remain active."; } }).rank({ thesis: agent.thesis, candidates: passing }) : new Map();
        const traded = tradeDemo(agent, candidates, scores, now);
        if (agent.trading.enabled) recordDemoPrices(traded.state, candidates, snapshot.at);
        const eligible = agent.status === "live" && !traded.pause && agent.markets.enabled
          ? marketCandidates(snapshot.markets, agent.markets.rules, new Set(stakes.map((s) => `pool:${s.marketId}`)), Math.floor(now / 1000)).slice(0, 6) : [];
        const judged = eligible.length ? await judgeMarkets(router, agent.thesis, eligible, Math.floor(now / 1000), 6) : new Map();
        if (eligible.length && !judged.size && !aiIssue) aiIssue = "Preview AI could not judge markets. No new paper stake this tick.";
        const stake = traded.pause ? null : stakeDemo(agent, traded.state, eligible, stakes, judged, now);
        if (aiIssue) demoEvent(traded.state, now, "hold", aiIssue);
        else if (!scores.size && !stake && agent.status === "live") demoEvent(traded.state, now, "hold", "No new paper entry. Waiting for fresh prices, matching rules or sufficient edge.");
        await ctx.runMutation(internal.demo.finishTick, { id: agent.id as Id<"demoAgents">, version, state: traded.state, pause: traded.pause, stake });
      } catch (err) {
        console.warn("[preview] paper tick failed", agent.id, err instanceof Error ? err.name : "unknown");
      }
    }
  },
});
