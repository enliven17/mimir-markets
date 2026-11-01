"use node";

// The twin reconciler, every 15 minutes (convex/crons.ts): every public pool on every enabled chain. The pass itself is
// lib/chains/twin-reconciler.ts and each twin's plan lib/chains/twins.ts; this file wires them to the index, Circle and
// the chains. In short: a house draft that failed on one chain, or a user's or an agent's pool, gets its missing leg
// opened from the house creator's Circle wallet on that chain (same question, labels, category, deadline and source)
// and linked by pairKey; an identical pool already there is linked instead. A user's pool waits for triage and passes
// moderation first; the seed is that chain's minimum stake on the creator's side (house drafts: CREATOR_STAKE_USDC on
// side A), out of the ONE house budget shared by every chain (convex/houseBudget.ts). VS duels are never mirrored.
// Env: the house creator wallets (ARC_CREATOR_WALLET / BASE_CREATOR_WALLET, with USDC, and ETH on Base), CIRCLE_API_KEY,
// CIRCLE_ENTITY_SECRET, TWIN_MIN_LEAD_MINUTES (30), TWIN_PER_CREATOR_DAY (3), TWIN_PER_TICK (4), TWIN_MAX_ATTEMPTS (3),
// MIMIR_PAUSE_TWINS=1 to stop, TWIN_DRY_RUN=1 to plan without opening.
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { usdToIndex } from "../lib/chains/amounts";
import { houseAddresses, houseCreatorWallet } from "../lib/chains/house";
import { serverMarketChains } from "../lib/chains/registry";
import { reconcileTwins, type TwinCandidate } from "../lib/chains/twin-reconciler";
import { budgetDay } from "../lib/chains/twins";
import { circleCreatePool, createdMarketId, walletGasWei, walletUsdcWei } from "../lib/server/chain-circle";
import { jevEnabled } from "../lib/jev";
import { jevModeration } from "../lib/moderation/jev-moderation";
import { localBlock } from "../lib/moderation/local-rules";
import { LOCK_SECONDS } from "../lib/arc/markets";

const envNum = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) ? n : fallback;
};

export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    await ctx.runQuery(internal.marketDeployment.check, {});
    const e = process.env;
    if (e.MIMIR_BACKEND_OFF === "1") return; // this deployment is switched off (crons.ts)
    await ctx.runMutation(internal.arcAdmin.beat, { name: "arc-twins" });
    if (e.MIMIR_PAUSE_TWINS === "1") return;
    const registry = serverMarketChains(e);
    if (registry.enabled.length < 2) return;
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);
    const minLead = envNum("TWIN_MIN_LEAD_MINUTES", 30) * 60;
    const house = new Set(houseAddresses(e));
    const day = budgetDay(nowMs);
    const houseStakeWei = usdToIndex(envNum("CREATOR_STAKE_USDC", 0.1));

    const { touched } = await reconcileTwins(
      {
        pending: () => ctx.runQuery(internal.arcTwinsDb.pending, {}),
        resolveTx: async (chain, tx) => {
          const indexed = await ctx.runQuery(internal.arcTwinsDb.marketIdByTx, { chain, tx });
          if (indexed !== null) return indexed;
          const cfg = registry.chains[chain];
          return cfg.enabled ? createdMarketId(cfg, "pool", tx as `0x${string}`).catch(() => null) : null;
        },
        candidates: async () =>
          (await ctx.runQuery(internal.arcTwinsDb.candidates, { closesAfter: now + LOCK_SECONDS + minLead, enabled: registry.enabled })) as TwinCandidate[],
        findSame: (target, pairKey, s) =>
          ctx.runQuery(internal.arcTwinsDb.findSame, { chain: target, pairKey, question: s.question, labelA: s.labelA, labelB: s.labelB, resolutionUrl: s.resolutionUrl, deadline: s.deadline }),
        planContext: async (s, target, isHouse) => ({
          now,
          target,
          targetMinStakeWei: registry.chains[target].contracts.minStakeWei,
          houseWallet: houseCreatorWallet(target, e)?.address ?? null,
          houseAddresses: house,
          houseStakeWei,
          budgetLeftWei: BigInt(await ctx.runQuery(internal.houseBudget.left, {})),
          jevOn: jevEnabled(),
          triage: s.triage,
          moderation: !isHouse && localBlock([s.question, s.labelA, s.labelB].join(" ")) ? "block" : null,
          creatorTwinsToday: isHouse ? 0 : await ctx.runQuery(internal.arcTwinsDb.creatorToday, { creator: s.creator.toLowerCase(), day }),
          perCreatorDay: envNum("TWIN_PER_CREATOR_DAY", 3),
          lockSeconds: LOCK_SECONDS,
          minLeadSeconds: minLead,
        }),
        moderate: async (s) => {
          const r = await jevModeration(
            { question: s.question, creator_position: s.labelA, opponent_position: s.labelB, category: s.category, settlement_rule: "", resolution_url: s.resolutionUrl },
            "twin",
          ).catch(() => null);
          return r?.decision === "block" ? "block" : null;
        },
        funded: async (target, seedWei) => {
          const cfg = registry.chains[target];
          const w = houseCreatorWallet(target, e);
          if (!w) return false;
          const [usdc, gas] = await Promise.all([walletUsdcWei(cfg, w.address), walletGasWei(cfg, w.address)]);
          return usdc >= seedWei && (cfg.gas.symbol !== "ETH" || gas > 0n);
        },
        reserve: async (target, seedWei, ref) => (await ctx.runMutation(internal.houseBudget.reserve, { chain: target, wei: seedWei.toString(), ref })) ?? null,
        release: async (hold) => {
          await ctx.runMutation(internal.houseBudget.release, { id: hold as Id<"houseSpend"> });
        },
        create: (target, s, side, seedWei) => {
          const w = houseCreatorWallet(target, e);
          if (!w) throw new Error(`no house creator wallet on ${target}`);
          return circleCreatePool(registry.chains[target], { walletId: w.id, address: w.address }, {
            question: s.question, labelA: s.labelA, labelB: s.labelB, resolutionUrl: s.resolutionUrl, category: s.category, deadline: s.deadline, side,
          }, seedWei);
        },
        createdId: (target, tx) => createdMarketId(registry.chains[target], "pool", tx as `0x${string}`),
        link: async (pairKey, a, b) => {
          await ctx.runMutation(internal.arc.link, { pairKey, chain: a.chain, kind: "pool", marketId: a.marketId });
          await ctx.runMutation(internal.arc.link, { pairKey, chain: b.chain, kind: "pool", marketId: b.marketId });
        },
        put: async (row) => {
          await ctx.runMutation(internal.arcTwinsDb.put, row);
        },
        log: (line) => console.log(line),
      },
      {
        now: nowMs,
        day,
        houseAddresses: house,
        perTick: envNum("TWIN_PER_TICK", 4),
        maxAttempts: envNum("TWIN_MAX_ATTEMPTS", 3),
        dryRun: e.TWIN_DRY_RUN === "1",
      },
    );
    for (const c of touched) await ctx.scheduler.runAfter(0, internal.arcSync.sync, { chain: c });
  },
});
