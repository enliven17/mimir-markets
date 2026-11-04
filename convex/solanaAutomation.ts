"use node";

import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { run } from "./solanaWorkers";
import { MimirSolanaClient } from "../lib/solana/client";
import { operatorKey, personaKey } from "../lib/solana/worker-key";
import { freeUsdc, stakeNative, ensureWalletUsdc } from "../lib/solana/worker-stake";
import { ST_OPEN, ST_ACTIVE, feeBalancePda } from "../lib/solana/config";
import { decisionClaim } from "../lib/solana/index-snapshot";
import { activePersonas } from "../agents/council/personas";
import { createThrottle, evaluatePersonaForClaim } from "../agents/council/shared/persona-runner";
import type { EvidenceCacheEntry } from "../agents/council/shared/types";
import { sizeStakeUnits } from "../agents/council/shared/persona-rules";
import { draftCryptoClaims } from "../agents/market-creator/crypto";
import { draftSportsClaims } from "../agents/market-creator/sports";
import { draftProblem } from "../agents/market-creator/draft";
import { signatureOf } from "../agents/market-creator/dedupe";
import { openHostedWallet } from "../lib/solana/hosted-wallet";
import { platformRouter } from "../lib/launch/llm";
import { byokRouter, type SealedKey } from "../lib/launch/byok";
import { judgeMarkets, DEFAULT_MARKET_RULES, type MarketView, type MarketRules } from "../lib/launch/markets";
import { challengerKellyStake } from "../lib/kelly";
import { buildAgentMarketPrompt, parseAgentDraft, agentDraftProblem } from "../lib/launch/agent-markets";
import { espnResult } from "../lib/espn";
import { councilCopyKey, launchCopyKey } from "../lib/launch/copy-key";
import roster from "../config/solana-roster.json";

const openNow = (c: { state: number; deadline: number }, now: number) => (c.state === ST_OPEN || c.state === ST_ACTIVE) && c.deadline > now + 300;
const unit = (n: number) => BigInt(Math.floor(n * 1e6));

export const creator = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => run(ctx, "creator", async () => {
    if (process.env.MIMIR_PAUSE_CREATOR === "1") return "paused";
    const client = new MimirSolanaClient(operatorKey()), cfg = await client.getConfig();
    if (!cfg || cfg.paused) return "program paused";
    const claims = await client.getAllClaims(), now = Math.floor(Date.now() / 1000);
    const own = claims.filter(c => c.creator.equals(client.publicKey));
    const day = now - now % 86_400;
    const daily = Math.min(2, Number(process.env.SOLANA_CREATOR_PER_DAY ?? 2));
    if (own.filter(c => c.createdAt >= day).length >= daily || own.filter(c => openNow(c, now)).length >= 3) return "inventory/daily limit";
    if (await freeUsdc(client) < 4_000_000n) return "fund the creator with test USDC";
    const drafts = await draftCryptoClaims(2, 360).catch(() => draftSportsClaims(2, 72));
    const draft = drafts.find(d => !draftProblem(d, now) && !claims.some(c => c.deadline === d.deadline && c.question === d.question));
    if (!draft) return "no eligible draft";
    await ensureWalletUsdc(client, 2_000_000n);
    const opened = await client.createClaim({ ...draft, stakeAmount: 2_000_000n, maxChallengers: 16 });
    await ctx.scheduler.runAfter(0, internal.solanaWorkers.sync, {});
    return `opened VS #${opened.claimId} with 2 test USDC`;
  }),
});

export const council = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => run(ctx, "council", async () => {
    if (process.env.MIMIR_PAUSE_COUNCIL === "1") return "paused";
    const admin = new MimirSolanaClient(operatorKey()), cfg = await admin.getConfig();
    if (!cfg || cfg.paused) return "program paused";
    const now = Math.floor(Date.now() / 1000), claims = (await admin.getAllClaims()).filter(c => openNow(c, now));
    if (!claims.length) return "no open markets";
    const standing = new Set(await ctx.runQuery(internal.arcCouncilDb.standing, { now: Date.now() }));
    const cache = new Map<string, EvidenceCacheEntry>(), throttle = createThrottle(2_000);
    const personas = activePersonas(), offset = Math.floor(Date.now() / 900_000) % personas.length;
    const ordered = [...personas.slice(offset), ...personas.slice(0, offset)];
    let decisions = 0, staked = 0;
    for (const c of claims) for (const p of ordered) {
      if (decisions >= 3) break;
      const key = `${p.slug}:solana:vs:${c.id}`;
      if (standing.has(key) || c.challengers.some(x => x.addr.toBase58() === (roster.council as Record<string,string>)[p.slug])) continue;
      decisions++;
      const d = await evaluatePersonaForClaim(p, decisionClaim(c), { evidenceCache: cache, throttle, houseCreator: roster.creator, mainnet: false, recordForecasts: false });
      let tx: string | undefined, txLayer: "base" | "er" = "base", amount = 0n;
      if (d.shouldStake && process.env.COUNCIL_DRY_RUN !== "1") {
        const trader = new MimirSolanaClient(personaKey(p.slug));
        const bankroll = await freeUsdc(trader);
        const wanted = sizeStakeUnits({ baseUsdc: 2, confidence: d.confidence, bankrollUnits: bankroll, creatorStakeUnits: c.creatorStake, totalChallengerStakeUnits: c.totalChallengerStake });
        amount = wanted && wanted > 0n ? (wanted > 2_000_000n ? 2_000_000n : wanted) : 0n;
        if (amount >= 2_000_000n) {
          try {
            if (await trader.baseConnection.getBalance(trader.publicKey) < 2_000_000) {
              await sendAndConfirmTransaction(admin.baseConnection, new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: trader.publicKey, lamports: 10_000_000 })), [operatorKey()], { commitment: "confirmed" });
            }
            txLayer = await trader.isDelegated(c.id) ? "er" : "base";
            tx = await stakeNative(trader, c.id, amount); staked++;
            await ctx.scheduler.runAfter(0, internal.solanaCopy.fanout, { agent: councilCopyKey(p.slug), marketId: Number(c.id), leaderTx: tx });
          } catch { amount = 0n; }
        }
      }
      const lean = d.verdict === "CHALLENGERS_WIN" ? 2 : d.verdict === "CREATOR_WINS" ? 1 : 0;
      await ctx.runMutation(internal.arcCouncilDb.record, { chain: "solana", kind: "vs", marketId: Number(c.id), slug: p.slug,
        outcome: tx ? "staked" : "abstained", rationale: d.rationale, ...(d.confidence === undefined ? {} : { confidence: d.confidence }), lean,
        ...(tx ? { txHash: tx, txLayer, amount: (amount * 1_000_000_000_000n).toString() } : {}), until: Date.now() + 3_600_000 });
      if (lean) await ctx.runMutation(internal.arcCouncilDb.saveTake, { chain: "solana", kind: "vs", marketId: Number(c.id), slug: p.slug, lean, confidence: d.confidence ?? 50, text: d.rationale.slice(0, 280), creator: c.creator.toBase58() });
    }
    if (staked) await ctx.scheduler.runAfter(0, internal.solanaWorkers.sync, {});
    return `${decisions} decisions, ${staked} stakes`;
  }),
});

export const agents = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => run(ctx, "agents", async () => {
    if (process.env.LAUNCH_SOLANA !== "1") return "disabled";
    const due = await ctx.runMutation(internal.launch.claimMarketAgents, { now: Date.now(), everyMs: 300_000, max: 3 });
    let changed = 0;
    for (const a of due) {
      const beforeAgent = changed;
      if (!a.solana) continue;
      const lease = await ctx.runMutation(internal.launchAgentsDb.acquire, { id: a.id }); if (lease === null) continue;
      try {
        const client = new MimirSolanaClient(openHostedWallet(a.solana));
        const cfg = await client.getConfig(); if (!cfg || cfg.paused) continue;
        const now = Math.floor(Date.now() / 1000), free = Number(await freeUsdc(client)) / 1e6;
        if (free < 2 || await client.baseConnection.getBalance(client.publicKey) < 500_000) continue;
        const rules: MarketRules = { ...DEFAULT_MARKET_RULES, ...a.markets.rules, chains: ["solana"] };
        const budget = Math.min(free, a.markets.budgetUsdc - a.openUsdc); if (budget < 2) continue;
        const router = a.brain.kind === "byok" ? byokRouter(a.uid, a.brain as unknown as SealedKey) : platformRouter;
        const claims = (await client.getAllClaims()).filter(c => openNow(c, now));
        const candidates = claims.filter(c => a.markets.enabled && !c.creator.equals(client.publicKey) && !c.challengers.some(p => p.addr.equals(client.publicKey)) && c.totalChallengerStake + 2_000_000n <= c.creatorStake * 5n && c.challengers.length < (c.maxChallengers || 16)
          && (!rules.categories.length || rules.categories.includes(c.category)) && c.deadline <= now + rules.maxHoursToClose * 3600 && c.deadline >= now + Math.max(5, rules.minMinutesToClose) * 60);
        const views: MarketView[] = candidates.slice(0, 8).map(c => ({ chain: "solana", kind: "vs", marketId: Number(c.id), question: c.question, labelA: c.creatorPosition, labelB: c.counterPosition, category: c.category, deadline: c.deadline, lockAt: 0, usdcA: Number(c.creatorStake) / 1e6, usdcB: Number(c.totalChallengerStake) / 1e6, status: c.state === 0 ? "open" : "active" }));
        const reads = await judgeMarkets(router, a.thesis, views, now);
        for (const c of candidates) {
          const read = reads.get(Number(c.id)); if (!read) continue;
          const p = 1 - read.pA, aUsd = Number(c.creatorStake) / 1e6, bUsd = Number(c.totalChallengerStake) / 1e6;
          const edge = p - (bUsd + 2) / (aUsd + bUsd + 2); if (edge < rules.minEdge) continue;
          const sized = challengerKellyStake({ confidencePct: p * 100, cap: rules.kellyFraction, bankroll: budget, creatorStake: aUsd, totalChallengerStake: bUsd, minStake: 2 });
          const stake = Math.floor(Math.min(sized, budget, rules.maxStakeUsdc, aUsd * 5 - bUsd) * 100) / 100;
          if (stake < 2) continue;
          const tx = await stakeNative(client, c.id, unit(stake), new PublicKey(a.owner));
          await ctx.runMutation(internal.launch.recordStake, { agent: a.id, chain: "solana", kind: "vs", marketId: Number(c.id), side: 2, usdc: stake, p, edge, why: read.why, tx, text: `Staked ${stake} test USDC on the counter position: ${read.why}` });
          await ctx.scheduler.runAfter(0, internal.solanaCopy.fanout, { agent: launchCopyKey(a.slug), marketId: Number(c.id), leaderTx: tx }); changed++; break;
        }
        // Owners may also allow their agent to open a market. The model drafts;
        // deterministic validation and the native program choose what is allowed.
        if (a.markets.create?.enabled && changed === beforeAgent) {
          const opened = await ctx.runQuery(internal.solanaAgentsDb.opened, { id: a.id });
          if (opened.today >= a.markets.create.perDay || Date.now() - opened.lastAt < 3 * 3_600_000) continue;
          const draft = await router.completeJson(buildAgentMarketPrompt(a.thesis, rules.categories, claims.map(c => c.question), now), parseAgentDraft).then(r => r.data).catch(() => null);
          if (!draft) continue;
          const kickoff = draft.category === "sports" ? (await espnResult(draft.resolutionUrl))?.startAt ?? null : undefined;
          if (agentDraftProblem(draft, { nowS: now, categories: rules.categories, open: claims.map(c => signatureOf(c, c.question)), kickoff })) continue;
          const owner = new PublicKey(a.owner);
          if (!(await client.baseConnection.getAccountInfo(feeBalancePda(owner)))) await client.openFeeAccount(owner);
          await ensureWalletUsdc(client, 2_000_000n);
          const result = await client.createClaim({ question: draft.question, creatorPosition: draft.side === 1 ? draft.labelA : draft.labelB, counterPosition: draft.side === 1 ? draft.labelB : draft.labelA, resolutionUrl: draft.resolutionUrl, category: draft.category, deadline: draft.deadline, stakeAmount: 2_000_000n, maxChallengers: 16, agent: owner });
          await ctx.runMutation(internal.launchMarketsDb.record, { agent: a.id, chain: "solana", question: draft.question, category: draft.category, resolutionUrl: draft.resolutionUrl, deadline: draft.deadline, side: 1, seedUsdc: 2, tx: result.txSig, why: draft.why }); changed++;
        }
      } catch (e) { console.warn(`[agents] ${a.slug}: ${e instanceof Error ? e.name : "Error"}`); }
      finally { await ctx.runMutation(internal.launchAgentsDb.release, { id: a.id, token: lease }); }
    }
    if (changed) await ctx.scheduler.runAfter(0, internal.solanaWorkers.sync, {});
    return `${due.length} agents considered, ${changed} transactions`;
  }),
});
