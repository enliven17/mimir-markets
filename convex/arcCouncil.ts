"use node";

// The council on Arc, as a Convex cron step (replaces agents/council/solana.ts for Arc markets). Each tick takes the
// open markets from the index, and for each (market, persona) pair still undecided runs the same persona pipeline
// (agents/council/shared/persona-runner.ts: category filter, rule personas, the LLM persona over one cached evidence
// fetch, Kelly sizing at the pool's odds). A persona that disagrees with the creator stakes side B from its own
// Circle developer-controlled wallet (lib/server/circle-w3s.ts); the key stays with Circle. Every decision is recorded
// (arcCouncilDb) and shown on the market page; a considered no stands for COUNCIL_REEVAL_MS.
// Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, ARC_COUNCIL_WALLETS (scripts/arc/council-wallets.ts), the LLM keys,
//      MIMIR_PAUSE_COUNCIL=1 to stop, COUNCIL_DRY_RUN=1 to decide without staking.
import type { PublicKey } from "@solana/web3.js";
import { parseEther } from "viem";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { activePersonas } from "../agents/council/personas";
import { createThrottle, evaluatePersonaForClaim } from "../agents/council/shared/persona-runner";
import { getOrFetchEvidence } from "../agents/council/shared/evidence-cache";
import { evaluateClaimAsPersona } from "../agents/council/shared/persona-llm";
import type { PersonaSpec } from "../agents/council/personas";
import type { ActionCtx } from "./_generated/server";
import { sizeStakeUnits } from "../agents/council/shared/persona-rules";
import type { CouncilClaim, EvidenceCacheEntry } from "../agents/council/shared/types";
import { arcPublicClient } from "../lib/arc/chain";
import { arcConfig } from "../lib/arc/config";
import { ENTRY_FEE_BPS } from "../lib/arc/fee-tiers";
import { LOCK_SECONDS, maxGrossFor, vsRoom } from "../lib/arc/markets";
import { councilWalletsFromEnv, executeContract } from "../lib/server/circle-w3s";

/** A tick fits well inside Convex's 10-minute action limit: each decision is one throttled LLM call at most. */
const MAX_DECISIONS_PER_TICK = Number(process.env.COUNCIL_MAX_DECISIONS ?? 12);
const REEVAL_MS = Number(process.env.COUNCIL_REEVAL_MS ?? 30 * 60_000);
const RETRY_MS = 10 * 60_000;
/** Leave the stake time to land before betting closes. */
const MARGIN_SECONDS = 5 * 60;

type Market = Doc<"arcMarkets">;
type Position = Doc<"arcPositions">;

/** The shared runner reads addresses through toBase58() / equals(); an Arc address behind that face. */
const addr = (a: string) => ({ toBase58: () => a, equals: (o: { toBase58(): string }) => o.toBase58() === a }) as unknown as PublicKey;
const units = (wei: string | bigint) => BigInt(wei) / 1_000_000_000_000n;

function asCouncilClaim(m: Market, positions: Position[]): CouncilClaim {
  return {
    id: BigInt(m.marketId),
    creator: addr(m.creator),
    question: m.question,
    creatorPosition: m.labelA,
    counterPosition: m.labelB,
    resolutionUrl: m.resolutionUrl,
    category: m.category,
    creatorStake: units(m.stakeA),
    totalChallengerStake: units(m.stakeB),
    deadline: m.deadline,
    state: m.status === "active" ? 1 : 0,
    maxChallengers: 100,
    challengers: positions.filter((p) => p.side === 2).map((p) => ({ addr: addr(p.user), stake: units(p.amount), paid: false })),
  } as unknown as CouncilClaim;
}

/** The house creator's Arc address: rule personas trade only its markets (persona-rules.ts). */
function houseCreator(): string | null {
  try {
    return (JSON.parse(process.env.ARC_CREATOR_WALLET ?? "null")?.address as string | undefined)?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** 6-dp units as the decimal USDC string Circle takes for msg.value. */
const usdcString = (u: bigint) => (Number(u) / 1e6).toFixed(6).replace(/\.?0+$/, "");

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    if (process.env.MIMIR_PAUSE_COUNCIL === "1") return;
    const e = process.env;
    const cfg = arcConfig({ network: e.ARC_NETWORK, rpcUrl: e.ARC_RPC, mimirV3: e.MIMIR_V3_ADDRESS, mimirPool: e.MIMIR_POOL_ADDRESS, minStake: e.MIMIR_MIN_STAKE });
    const { mimirV3, mimirPool } = cfg.contracts;
    const wallets = councilWalletsFromEnv();
    if (!mimirV3 || !mimirPool || !Object.keys(wallets).length) return;
    const dryRun = e.COUNCIL_DRY_RUN === "1";
    const client = arcPublicClient(cfg);
    const now = Math.floor(Date.now() / 1000);

    const markets = await ctx.runQuery(internal.arc.openMarkets, { closesAfter: now + LOCK_SECONDS + MARGIN_SECONDS });
    const standing = new Set(await ctx.runQuery(internal.arcCouncilDb.standing, { now: Date.now() }));
    const evidenceCache = new Map<string, EvidenceCacheEntry>();
    const throttle = createThrottle(Number(e.COUNCIL_LLM_THROTTLE_MS ?? 4500));
    const balances = new Map<string, bigint>();

    // Comment mode: one take per market from the best-suited persona, no stake (COUNCIL_COMMENTS, on by default).
    if (e.COUNCIL_COMMENTS !== "0") await writeTakes(ctx, markets, evidenceCache, throttle);
    // Betting can be switched off on its own (mainnet: COUNCIL_BETS=0 saves the USDC and most of the LLM spend).
    if (e.COUNCIL_BETS === "0") return;

    let decisions = 0;
    let staked = false;

    // Closest deadline first: those are the markets about to stop taking positions.
    for (const m of markets.sort((a, b) => a.deadline - b.deadline)) {
      const full = await ctx.runQuery(internal.arc.marketWithPositions, { kind: m.kind, marketId: m.marketId });
      if (!full) continue;
      const claim = asCouncilClaim(m, full.positions);
      const inMarket = new Set(full.positions.map((p) => p.user));
      for (const persona of activePersonas()) {
        if (decisions >= MAX_DECISIONS_PER_TICK) break;
        const wallet = wallets[persona.slug];
        if (!wallet || standing.has(`${persona.slug}:${m.kind}:${m.marketId}`)) continue;
        const me = wallet.address.toLowerCase();
        // Personas only challenge: never their own market, and once per market.
        if (m.creator === me || inMarket.has(me)) continue;

        decisions++;
        const record = (d: { outcome: "staked" | "abstained" | "retry" | "failed"; rationale: string; confidence?: number; amount?: string; txHash?: string; until: number }) =>
          ctx.runMutation(internal.arcCouncilDb.record, { slug: persona.slug, kind: m.kind, marketId: m.marketId, ...d });
        try {
          const decision = await evaluatePersonaForClaim(persona, claim, { evidenceCache, throttle, recordForecasts: false, houseCreator: houseCreator(), mainnet: cfg.network === "mainnet" });
          if (!decision.shouldStake) {
            const transient = decision.skipReason === "llm-failed" || decision.skipReason === "no-evidence";
            const considered = !transient && persona.archetype !== "rule-based";
            await record({ outcome: considered ? "abstained" : "retry", rationale: decision.rationale, confidence: decision.confidence, until: Date.now() + (considered ? REEVAL_MS : RETRY_MS) });
            continue;
          }
          if (!balances.has(me)) balances.set(me, await client.getBalance({ address: wallet.address }));
          const bankroll = units(balances.get(me)!);
          let stake = sizeStakeUnits({ baseUsdc: persona.stakeUsdc, confidence: decision.confidence, bankrollUnits: bankroll, creatorStakeUnits: claim.creatorStake, totalChallengerStakeUnits: claim.totalChallengerStake });
          if (stake === null || stake === 0n) {
            await record({ outcome: "abstained", rationale: stake === null ? `${persona.displayName} is out of USDC on Arc.` : `${persona.displayName} sits out: no +EV stake at these pool odds.`, confidence: decision.confidence, until: Date.now() + REEVAL_MS });
            continue;
          }
          if (m.kind === "vs") {
            // The 5x cap counts net stakes; personas pay the standard entry fee.
            const room = units(maxGrossFor(vsRoom(BigInt(m.stakeA), BigInt(m.stakeB)), ENTRY_FEE_BPS[0]));
            if (room < units(cfg.contracts.minStakeWei)) {
              await record({ outcome: "abstained", rationale: `${persona.displayName} would challenge, but the market is full.`, confidence: decision.confidence, until: Date.now() + REEVAL_MS });
              continue;
            }
            if (stake > room) stake = room;
          }
          const amount = usdcString(stake);
          if (dryRun) {
            await record({ outcome: "abstained", rationale: `[dry run] would stake ${amount} USDC. ${decision.rationale}`, confidence: decision.confidence, until: Date.now() + RETRY_MS });
            continue;
          }
          const wei = parseEther(amount);
          const txHash =
            m.kind === "vs"
              ? await executeContract({ walletId: wallet.id, contractAddress: mimirV3, abiFunctionSignature: "challengeClaim(uint256,uint256,string,address)", abiParameters: [BigInt(m.marketId), wei, "", "0x0000000000000000000000000000000000000000"], amount })
              : await executeContract({ walletId: wallet.id, contractAddress: mimirPool, abiFunctionSignature: "stake(uint256,uint8,address)", abiParameters: [BigInt(m.marketId), 2, "0x0000000000000000000000000000000000000000"], amount });
          balances.set(me, balances.get(me)! - wei);
          inMarket.add(me);
          staked = true;
          console.log(`[council] ${persona.slug} staked ${amount} USDC on ${m.kind} #${m.marketId} ${txHash}`);
          // A stake stands for good: a persona is in once per market.
          await record({ outcome: "staked", rationale: decision.rationale, confidence: decision.confidence, amount: wei.toString(), txHash, until: Number.MAX_SAFE_INTEGER });
        } catch (err) {
          const msg = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 300);
          console.warn(`[council] ${persona.slug} on ${m.kind} #${m.marketId}: ${msg}`);
          await record({ outcome: "failed", rationale: msg, until: Date.now() + RETRY_MS });
        }
      }
      if (decisions >= MAX_DECISIONS_PER_TICK) break;
    }
    if (staked) await ctx.scheduler.runAfter(0, internal.arcSync.sync, {});
  },
});

const TAKES_PER_TICK = Number(process.env.COUNCIL_TAKES_PER_TICK ?? 3);
// Anyone can open markets cheaply; a creator gets this many takes a day so a bot cannot spend the backend's model quota.
const TAKES_PER_CREATOR_DAY = Number(process.env.COUNCIL_TAKES_PER_CREATOR_DAY ?? 3);
const LEAN = { CREATOR_WINS: 1, CHALLENGERS_WIN: 2, DRAW: 0, UNRESOLVABLE: 0 } as const;

/**
 * The persona best placed to read a market: the specialist for its category (crypto, sports, weather), else the
 * Statistician, else Socrates. Rule personas never comment: they have no read, only pool arithmetic.
 */
function bestPersonaFor(category: string): PersonaSpec | null {
  const all = activePersonas().filter((p) => p.archetype !== "rule-based");
  const c = category.toLowerCase();
  return (
    all.find((p) => p.categoryFilter?.some((f) => c.includes(f))) ??
    all.find((p) => p.slug === "statistician") ??
    all.find((p) => p.slug === "socrates") ??
    all[0] ??
    null
  );
}

/** One take for each open market that has none yet: one evidence fetch and one LLM call each, a few per tick. */
async function writeTakes(ctx: ActionCtx, markets: Market[], evidenceCache: Map<string, EvidenceCacheEntry>, throttle: () => Promise<void>) {
  const takes = await ctx.runQuery(internal.arcCouncilDb.takenMarkets, {});
  const taken = new Set(takes.map((t) => t.key));
  const today = new Map<string, number>();
  for (const t of takes) if (t.at > Date.now() - 86_400_000) today.set(t.creator, (today.get(t.creator) ?? 0) + 1);
  const house = (JSON.parse(process.env.ARC_CREATOR_WALLET ?? "null") as { address?: string } | null)?.address?.toLowerCase();
  let written = 0;
  for (const m of markets.sort((a, b) => b.createdAt - a.createdAt)) {
    if (written >= TAKES_PER_TICK) break;
    if (taken.has(`${m.kind}:${m.marketId}`)) continue;
    const creator = m.creator.toLowerCase();
    if (creator !== house && (today.get(creator) ?? 0) >= TAKES_PER_CREATOR_DAY) continue;
    const persona = bestPersonaFor(m.category);
    if (!persona) return;
    try {
      const claim = asCouncilClaim(m, []);
      const evidence = await getOrFetchEvidence(`${m.kind}:${m.marketId}`, m.resolutionUrl, evidenceCache);
      await throttle();
      const v = await evaluateClaimAsPersona(persona, claim, evidence.text);
      await ctx.runMutation(internal.arcCouncilDb.saveTake, {
        kind: m.kind,
        marketId: m.marketId,
        slug: persona.slug,
        lean: LEAN[v.verdict],
        confidence: v.confidence,
        text: v.explanation.slice(0, 600),
        creator,
      });
      today.set(creator, (today.get(creator) ?? 0) + 1);
      written++;
      console.log(`[council] take on ${m.kind} #${m.marketId} by ${persona.slug}: ${v.verdict} ${v.confidence}%`);
    } catch (err) {
      console.warn(`[council] take on ${m.kind} #${m.marketId}:`, err instanceof Error ? err.message : err);
    }
  }
}
