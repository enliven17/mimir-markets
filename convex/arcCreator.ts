"use node";

// The house market creator on Arc, as a Convex cron step (replaces agents/market-creator/solana.ts). Each tick:
//   1. cancel its own VS claims that closed with no challenger (their stake comes back)
//   2. count its joinable markets; at MAX_ACTIVE_CLAIMS, stop
//   3. draft from the same rule-built sources (crypto, $ANSEM, sports, stocks, Polymarket when enabled), gate them on
//      chain limits and the decidability score, drop duplicates of its live markets, optionally council-preflight them
//   4. open each as a two-sided pool (anyone stakes either side) from the creator's Circle developer-controlled
//      wallet (the key stays with Circle); its stake backs side A. A pool nobody joined is refunded by the oracle.
//      Leftover VS claims from before the switch are still cancelled by step 1.
// Env: ARC_CREATOR_WALLET ({"id","address"}), CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, the CREATOR_* knobs of the old
//      worker, MIMIR_PAUSE_CREATE_MARKET=1, MARKET_CREATOR_DRY_RUN=1.
import { parseEther } from "viem";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { gatherCouncilPreflight, preflightKeeps, preflightPersonas } from "../agents/market-creator/council-preflight";
import { draftProblem, scoreDraft, type DraftClaim } from "../agents/market-creator/draft";
import { draftCryptoClaims } from "../agents/market-creator/crypto";
import { defaultAnsemPerRun, draftAnsemClaims } from "../agents/market-creator/ansem";
import { draftSportsClaims } from "../agents/market-creator/sports";
import { draftStockClaims } from "../agents/market-creator/stocks";
import { fetchPolymarketCandidates, isPolymarketEnabled, polymarketDraft } from "../agents/market-creator/polymarket";
import { filterDuplicates, signatureOf } from "../agents/market-creator/dedupe";
import { arcPublicClient } from "../lib/arc/chain";
import { arcConfig } from "../lib/arc/config";
import { executeContract } from "../lib/server/circle-w3s";

const envNum = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== undefined && process.env[name] !== "" ? n : fallback;
};
const CREATE_POOL = "createMarket(string,string,string,string,string,uint256,uint8,address)";
const SIDE_A = 1;
const ZERO = "0x0000000000000000000000000000000000000000";

function creatorWallet(): { id: string; address: `0x${string}` } | null {
  try {
    const w = JSON.parse(process.env.ARC_CREATOR_WALLET ?? "null");
    return w?.id && w?.address ? { id: w.id, address: String(w.address).toLowerCase() as `0x${string}` } : null;
  } catch {
    return null;
  }
}

async function gatherDrafts(isMainnet: boolean): Promise<DraftClaim[]> {
  const polymarketPerRun = envNum("CREATOR_POLYMARKET_PER_RUN", 2);
  const [crypto, ansem, sports, polymarket] = await Promise.all([
    draftCryptoClaims(envNum("CREATOR_CRYPTO_PER_RUN", 2), envNum("CREATOR_HORIZON_MIN", 30)).catch(() => []),
    draftAnsemClaims(envNum("CREATOR_ANSEM_PER_RUN", Number(defaultAnsemPerRun(isMainnet))), envNum("CREATOR_HORIZON_MIN", 30)).catch(() => []),
    draftSportsClaims(envNum("CREATOR_SPORTS_PER_RUN", 3), envNum("CREATOR_SPORTS_MAX_HOURS", 72)).catch(() => []),
    isPolymarketEnabled() && polymarketPerRun > 0 ? fetchPolymarketCandidates().catch(() => []) : Promise.resolve([]),
  ]);
  const stocks = draftStockClaims(envNum("CREATOR_STOCKS_PER_RUN", 1));
  const borrowed = polymarket.map(polymarketDraft).filter((d): d is DraftClaim => d !== null).slice(0, polymarketPerRun);
  console.log(`[creator] sources: crypto=${crypto.length} ansem=${ansem.length} sports=${sports.length} stocks=${stocks.length} polymarket=${borrowed.length}`);
  return [...sports, ...borrowed, ...stocks, ...ansem, ...crypto];
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
    const wallet = creatorWallet();
    const cfg = arcConfig({ network: e.ARC_NETWORK, rpcUrl: e.ARC_RPC, mimirV3: e.MIMIR_V3_ADDRESS, mimirPool: e.MIMIR_POOL_ADDRESS });
    const v3 = cfg.contracts.mimirV3;
    const pool = cfg.contracts.mimirPool;
    if (!wallet || !v3 || !pool) return;
    const dryRun = e.MARKET_CREATOR_DRY_RUN === "1";
    const now = Math.floor(Date.now() / 1000);
    const own: Doc<"arcMarkets">[] = await ctx.runQuery(internal.arc.marketsBy, { creator: wallet.address });

    // 1. Its own VS claims that closed with nobody on the other side: cancel, the stake comes back.
    for (const m of own.filter((m) => m.kind === "vs" && m.status === "open" && m.deadline <= now)) {
      if (dryRun) continue;
      try {
        const tx = await executeContract({ walletId: wallet.id, contractAddress: v3, abiFunctionSignature: "cancelClaim(uint256)", abiParameters: [BigInt(m.marketId)] });
        console.log(`[creator] cancelled empty VS #${m.marketId} ${tx}`);
      } catch (err) {
        console.warn(`[creator] cancel VS #${m.marketId}:`, err instanceof Error ? err.message : err);
      }
    }

    if (e.MIMIR_PAUSE_CREATE_MARKET === "1") return;
    const live = own.filter((m) => (m.status === "open" || m.status === "active") && m.deadline > now);
    const headroom = envNum("MAX_ACTIVE_CLAIMS", 30) - live.length;
    if (headroom <= 0) {
      console.log(`[creator] inventory at cap (${live.length})`);
      return;
    }

    const signatures = live.map((m) => signatureOf({ category: m.category, question: m.question, resolutionUrl: m.resolutionUrl }, `${m.kind} #${m.marketId}`));
    const unique = filterDuplicates(gateDrafts(await gatherDrafts(cfg.network === "mainnet")), signatures, (d, why) => console.warn(`[draft] drop (duplicate, ${why}): ${d.label}`));
    const drafts = (await vetDrafts(unique)).slice(0, headroom);
    if (!drafts.length) {
      console.log("[creator] no drafts this cycle");
      return;
    }

    const stakeUsdc = envNum("CREATOR_STAKE_USDC", 0.1);
    // A daily budget: what the house stakes on the markets it opens today (UTC) stays under it, so a creator that
    // keeps losing its stakes costs at most this much a day. Cancelled empty markets give theirs back.
    const budget = envNum("CREATOR_DAILY_BUDGET_USDC", 1);
    const dayStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);
    // ponytail: counts each market at today's stake; a pool's stakeA also holds other people's money on side A.
    const spentToday = own.filter((m) => m.createdAt >= dayStart && m.status !== "cancelled").length * stakeUsdc;
    const affordable = Math.max(0, Math.floor((budget - spentToday + 1e-9) / stakeUsdc));
    if (affordable === 0) {
      console.log(`[creator] daily budget used (${spentToday.toFixed(2)} of ${budget} USDC)`);
      return;
    }
    // At most CREATOR_DAILY_MARKETS markets a day (UTC), whatever the budget allows.
    const openedToday = own.filter((m) => m.createdAt >= dayStart).length;
    const dailyLeft = Math.max(0, envNum("CREATOR_DAILY_MARKETS", 2) - openedToday);
    if (dailyLeft === 0) {
      console.log(`[creator] daily market count reached (${openedToday})`);
      return;
    }
    drafts.splice(Math.min(affordable, dailyLeft));
    const balance = await arcPublicClient(cfg).getBalance({ address: wallet.address });
    if (balance < parseEther((stakeUsdc * drafts.length).toFixed(6))) {
      console.warn(`[creator] not enough USDC on ${wallet.address} for ${drafts.length} markets; top it up`);
      return;
    }

    let created = 0;
    for (const d of drafts) {
      if (dryRun) {
        console.log(`[creator] (dry run) would open [${d.category}] "${d.question}" closing ${new Date(d.deadline * 1000).toISOString()}`);
        continue;
      }
      try {
        const amount = stakeUsdc.toFixed(6);
        const tx = await executeContract({
          walletId: wallet.id,
          contractAddress: pool,
          abiFunctionSignature: CREATE_POOL,
          abiParameters: [d.question, d.creatorPosition, d.counterPosition, d.resolutionUrl, d.category, BigInt(d.deadline), SIDE_A, ZERO],
          amount,
        });
        created++;
        console.log(`[creator] opened [${d.category}] ${d.label} ${tx}`);
      } catch (err) {
        console.error(`[creator] failed (${d.label}):`, err instanceof Error ? err.message : err);
      }
    }
    if (created) await ctx.scheduler.runAfter(0, internal.arcSync.sync, {});
  },
});
