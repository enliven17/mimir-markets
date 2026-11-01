"use node";

// The house market creator on every enabled market chain, as a Convex cron step. Each tick:
//   1. cancel its own VS claims that closed with no challenger (their stake comes back), on each chain
//   2. count its joinable markets; at MAX_ACTIVE_CLAIMS, stop
//   3. draft from the same rule-built sources (crypto, $ANSEM, sports, stocks, Polymarket when enabled), gate them on
//      chain limits and the decidability score, drop duplicates of its live markets, optionally council-preflight them
//   4. open each as a two-sided pool (anyone stakes either side) on EVERY enabled chain where the creator has a
//      Circle developer-controlled wallet (the key stays with Circle), Base first; its stake backs side A. The copies
//      share a pairKey (lib/chains/linked.ts): the page links them and the oracle settles them with one decision.
//      A pool nobody joined is refunded by the oracle. Leftover VS claims from before the switch are cancelled by step 1.
// Budgets (CREATOR_DAILY_BUDGET_USDC, CREATOR_DAILY_MARKETS) count each chain on its own.
// Env: ARC_CREATOR_WALLET / BASE_CREATOR_WALLET ({"id","address"}; the Base one needs ETH for gas and USDC), CIRCLE_API_KEY,
//      CIRCLE_ENTITY_SECRET, the CREATOR_* knobs of the old worker, MIMIR_PAUSE_CREATE_MARKET=1, MARKET_CREATOR_DRY_RUN=1.

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { gatherCouncilPreflight, preflightKeeps, preflightPersonas } from "../agents/market-creator/council-preflight";
import { draftProblem, scoreDraft, type DraftClaim } from "../agents/market-creator/draft";
import { draftCryptoClaims } from "../agents/market-creator/crypto";
import { draftSportsClaims } from "../agents/market-creator/sports";
import { draftStockClaims } from "../agents/market-creator/stocks";
import { fetchPolymarketCandidates, isPolymarketEnabled, polymarketDraft } from "../agents/market-creator/polymarket";
import { filterDuplicates, signatureOf } from "../agents/market-creator/dedupe";
import { usdToIndex } from "../lib/chains/amounts";
import { houseCreatorWallet, type CircleWallet } from "../lib/chains/house";
import { pairKeyOf } from "../lib/chains/linked";
import { serverMarketChains, type MarketChain, type MarketChainId } from "../lib/chains/registry";
import { circleCancelVs, circleCreatePool, createdMarketId, walletGasWei, walletUsdcWei } from "../lib/server/chain-circle";

const envNum = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== undefined && process.env[name] !== "" ? n : fallback;
};
const SIDE_A = 1;

async function gatherDrafts(): Promise<DraftClaim[]> {
  const polymarketPerRun = envNum("CREATOR_POLYMARKET_PER_RUN", 2);
  const [crypto, sports, polymarket] = await Promise.all([
    draftCryptoClaims(envNum("CREATOR_CRYPTO_PER_RUN", 2), envNum("CREATOR_HORIZON_MIN", 30)).catch(() => []),
    draftSportsClaims(envNum("CREATOR_SPORTS_PER_RUN", 3), envNum("CREATOR_SPORTS_MAX_HOURS", 72)).catch(() => []),
    isPolymarketEnabled() && polymarketPerRun > 0 ? fetchPolymarketCandidates().catch(() => []) : Promise.resolve([]),
  ]);
  const stocks = draftStockClaims(envNum("CREATOR_STOCKS_PER_RUN", 1));
  const borrowed = polymarket.map(polymarketDraft).filter((d): d is DraftClaim => d !== null).slice(0, polymarketPerRun);
  console.log(`[creator] sources: crypto=${crypto.length} sports=${sports.length} stocks=${stocks.length} polymarket=${borrowed.length}`);
  return [...sports, ...borrowed, ...stocks, ...crypto];
}

function gateDrafts(drafts: DraftClaim[]): DraftClaim[] {
  const minQuality = envNum("CREATOR_MIN_QUALITY", 60);
  return drafts.filter((d) => {
    const problem = draftProblem(d);
    if (problem) return console.warn(`[draft] drop (${problem}): ${d.label}`), false;
    const q = scoreDraft(d);
    if (q.score < minQuality) return console.warn(`[draft] drop (quality ${q.score}): ${d.label}`), false;
    return true;
  });
}

async function vetDrafts(drafts: DraftClaim[]): Promise<DraftClaim[]> {
  if (process.env.MARKET_CREATOR_PREFLIGHT !== "1" || !drafts.length) return drafts;
  const personas = preflightPersonas(process.env.MARKET_CREATOR_PREFLIGHT_PERSONAS);
  const minScore = envNum("MARKET_CREATOR_PREFLIGHT_MIN_SCORE", 60);
  const kept: DraftClaim[] = [];
  for (const d of drafts) {
    const result = await gatherCouncilPreflight({
      candidate: {
        question: d.question,
        creatorPosition: d.creatorPosition,
        counterPosition: d.counterPosition,
        resolutionUrl: d.resolutionUrl,
        category: d.category,
        settlementRule: d.settlementRule,
        deadlineHours: Math.max(0, (d.deadline * 1000 - Date.now()) / 3_600_000),
      },
      personas,
      sequentialGapMs: 4_000,
    }).catch(() => null);
    if (!result || preflightKeeps(result, minScore)) kept.push(d);
  }
  return kept;
}

export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    if (process.env.MIMIR_BACKEND_OFF === "1") return; // this deployment is switched off (crons.ts)
    await ctx.runMutation(internal.arcAdmin.beat, { name: "arc-creator" });
    const e = process.env;
    const registry = serverMarketChains(e);
    // Each enabled chain where the house has a wallet, Base first (the registry's order).
    const sides: Array<{ cfg: MarketChain; wallet: CircleWallet; own: Array<Doc<"arcMarkets"> & { chain: MarketChainId }> }> = [];
    for (const id of registry.enabled) {
      const wallet = houseCreatorWallet(id, e);
      if (!wallet) continue;
      sides.push({ cfg: registry.chains[id], wallet, own: await ctx.runQuery(internal.arc.marketsBy, { creator: wallet.address, chain: id }) });
    }
    if (!sides.length) return;
    const dryRun = e.MARKET_CREATOR_DRY_RUN === "1";
    const now = Math.floor(Date.now() / 1000);

    // 1. Its own VS claims that closed with nobody on the other side: cancel, the stake comes back.
    for (const { cfg, wallet, own } of sides) {
      for (const m of own.filter((m) => m.kind === "vs" && m.status === "open" && m.deadline <= now)) {
        if (dryRun) continue;
        try {
          const tx = await circleCancelVs(cfg, wallet.id, m.marketId);
          console.log(`[creator] ${cfg.id}: cancelled empty VS #${m.marketId} ${tx}`);
        } catch (err) {
          console.warn(`[creator] ${cfg.id}: cancel VS #${m.marketId}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    if (e.MIMIR_PAUSE_CREATE_MARKET === "1") return;
    const liveOf = (own: (typeof sides)[number]["own"]) => own.filter((m) => (m.status === "open" || m.status === "active") && m.deadline > now);
    // Inventory is counted on the fullest chain (the copies of one draft are one market to the house).
    const live = sides.flatMap((s) => liveOf(s.own));
    const headroom = envNum("MAX_ACTIVE_CLAIMS", 30) - Math.max(...sides.map((s) => liveOf(s.own).length));
    if (headroom <= 0) {
      console.log(`[creator] inventory at cap (${live.length})`);
      return;
    }

    const signatures = live.map((m) => signatureOf({ category: m.category, question: m.question, resolutionUrl: m.resolutionUrl }, `${m.chain} ${m.kind} #${m.marketId}`));
    const unique = filterDuplicates(gateDrafts(await gatherDrafts()), signatures, (d, why) => console.warn(`[draft] drop (duplicate, ${why}): ${d.label}`));
    const drafts = (await vetDrafts(unique)).slice(0, headroom);
    if (!drafts.length) {
      console.log("[creator] no drafts this cycle");
      return;
    }

    const stakeUsdc = envNum("CREATOR_STAKE_USDC", 0.1);
    // A daily budget per chain: what the house stakes on the markets it opens today (UTC) stays under it, so a creator
    // that keeps losing its stakes costs at most this much a day. Cancelled empty markets give theirs back.
    const budget = envNum("CREATOR_DAILY_BUDGET_USDC", 1);
    const dayStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);
    const seed = usdToIndex(stakeUsdc);
    // How many markets each chain can still open today (budget, daily count, USDC and gas in the wallet).
    const room = new Map<MarketChainId, number>();
    for (const { cfg, wallet, own } of sides) {
      // ponytail: counts each market at today's stake; a pool's stakeA also holds other people's money on side A.
      const spentToday = own.filter((m) => m.createdAt >= dayStart && m.status !== "cancelled").length * stakeUsdc;
      const affordable = Math.max(0, Math.floor((budget - spentToday + 1e-9) / stakeUsdc));
      // At most CREATOR_DAILY_MARKETS markets a day (UTC) per chain, whatever the budget allows.
      const dailyLeft = Math.max(0, envNum("CREATOR_DAILY_MARKETS", 2) - own.filter((m) => m.createdAt >= dayStart).length);
      let n = Math.min(affordable, dailyLeft, drafts.length);
      if (n > 0) {
        const [usdc, gas] = await Promise.all([walletUsdcWei(cfg, wallet.address), walletGasWei(cfg, wallet.address)]);
        if (usdc < seed * BigInt(n)) {
          console.warn(`[creator] ${cfg.id}: not enough USDC on ${wallet.address} for ${n} markets; top it up`);
          n = Number(usdc / seed);
        }
        if (cfg.gas.symbol === "ETH" && gas === 0n) {
          console.warn(`[creator] ${cfg.id}: no ETH for gas on ${wallet.address}; top it up`);
          n = 0;
        }
      }
      room.set(cfg.id, n);
    }
    if (![...room.values()].some((n) => n > 0)) {
      console.log(`[creator] daily budget or count used on every chain`);
      return;
    }

    const opened = new Set<MarketChainId>();
    for (const d of drafts) {
      const targets = sides.filter((s) => (room.get(s.cfg.id) ?? 0) > 0);
      if (!targets.length) break;
      if (dryRun) {
        console.log(`[creator] (dry run) would open on ${targets.map((t) => t.cfg.id).join("+")} [${d.category}] "${d.question}" closing ${new Date(d.deadline * 1000).toISOString()}`);
        continue;
      }
      // One pairKey per draft: the copies on each chain are linked (page link, one oracle decision).
      const pairKey = targets.length > 1 ? pairKeyOf("house", d) : null;
      for (const { cfg, wallet } of targets) {
        try {
          const tx = await circleCreatePool(cfg, { walletId: wallet.id, address: wallet.address }, {
            question: d.question, labelA: d.creatorPosition, labelB: d.counterPosition, resolutionUrl: d.resolutionUrl, category: d.category, deadline: d.deadline, side: SIDE_A,
          }, seed);
          room.set(cfg.id, (room.get(cfg.id) ?? 1) - 1);
          opened.add(cfg.id);
          console.log(`[creator] ${cfg.id}: opened [${d.category}] ${d.label} ${tx}`);
          if (pairKey) {
            const marketId = await createdMarketId(cfg, "pool", tx).catch(() => null);
            if (marketId !== null) await ctx.runMutation(internal.arc.link, { pairKey, chain: cfg.id, kind: "pool", marketId });
            else console.warn(`[creator] ${cfg.id}: opened but could not read the market id of ${tx}; not linked`);
          }
        } catch (err) {
          console.error(`[creator] ${cfg.id}: failed (${d.label}):`, err instanceof Error ? err.message : err);
        }
      }
    }
    for (const c of opened) await ctx.scheduler.runAfter(0, internal.arcSync.sync, { chain: c });
  },
});
