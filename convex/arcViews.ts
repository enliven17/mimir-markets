// Read-only views for the Arc UI that span tables: the council roster (each persona's Arc wallet, record and recent
// stakes) and the oracle's totals. Wallet addresses come from ARC_COUNCIL_WALLETS (public addresses, no secrets).
import { privateKeyToAccount } from "viem/accounts";
import { v } from "convex/values";
import { query } from "./_generated/server";

type Wallets = Record<string, { id: string; address: string }>;

const VERDICT_COUNT_CAP = 5000;

function councilWallets(): Wallets {
  try {
    return JSON.parse(process.env.ARC_COUNCIL_WALLETS ?? "{}") as Wallets;
  } catch {
    return {};
  }
}

/** Every persona with an Arc wallet: address, record on settled markets, money still at risk, last stakes. */
export const council = query({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const [slug, w] of Object.entries(councilWallets())) {
      const address = w.address.toLowerCase();
      const positions = await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", address)).order("desc").take(300);
      let won = 0;
      let lost = 0;
      let atRisk = 0n;
      const bets = [];
      for (const p of positions) {
        const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", p.kind).eq("marketId", p.marketId)).unique();
        if (!m) continue;
        const settled = m.status === "resolved" || m.status === "cancelled";
        if (!settled) atRisk += BigInt(p.amount);
        else if (m.winner === p.side) won++;
        else if (m.winner === 1 || m.winner === 2) lost++;
        bets.push({ kind: p.kind, marketId: p.marketId, amount: p.amount, question: m.question, createdAt: m.createdAt });
      }
      bets.sort((a, b) => b.createdAt - a.createdAt);
      out.push({ slug, address, stakes: positions.length, won, lost, atRisk: atRisk.toString(), recentBets: bets.slice(0, 5) });
    }
    return out;
  },
});

/** The oracle's Arc address and how many verdicts it has published. */
export const oracle = query({
  args: {},
  handler: async (ctx) => {
    const key = process.env.ARC_ORACLE_KEY?.trim();
    // Only the public address leaves this function.
    const address = key && /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as `0x${string}`).address : null;
    // Bounded count: past VERDICT_COUNT_CAP the page shows "N+".
    const verdicts = await ctx.db.query("arcVerdicts").take(VERDICT_COUNT_CAP);
    return { address, verdicts: verdicts.length, capped: verdicts.length >= VERDICT_COUNT_CAP };
  },
});


/**
 * VS markets where any of `wallets` (lowercase Arc addresses) holds a challenger position, in `statuses`, with every
 * position: the Arc side of baskets and copy trading (lib/server/arc-baskets.ts).
 */
export const challengedBy = query({
  args: { wallets: v.array(v.string()), statuses: v.array(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { wallets, statuses, limit }) => {
    const want = new Set(statuses);
    const seen = new Set<number>();
    const out = [];
    for (const w of wallets.slice(0, 50)) {
      const legs = await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", w.toLowerCase())).order("desc").take(400);
      for (const leg of legs) {
        if (leg.kind !== "vs" || leg.side !== 2 || seen.has(leg.marketId)) continue;
        const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("kind", "vs").eq("marketId", leg.marketId)).unique();
        if (!m || m.isPrivate || !want.has(m.status)) continue;
        seen.add(leg.marketId);
        const positions = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("kind", "vs").eq("marketId", leg.marketId)).take(500);
        out.push({ ...m, positions: positions.map((p) => ({ user: p.user, side: p.side, amount: p.amount })) });
      }
    }
    out.sort((a, b) => b.marketId - a.marketId);
    return out.slice(0, Math.min(limit ?? 200, 1000));
  },
});

/** Total staked per Arc address (gross of nothing: the net stakes the index holds), for the campaign board. */
export const volumeByUser = query({
  args: {},
  handler: async (ctx) => {
    // ponytail: bounded scan of the newest 12k positions per board refresh (the route caches 60s); an aggregate table past that.
    const totals = new Map<string, number>();
    for (const p of await ctx.db.query("arcPositions").order("desc").take(12_000)) totals.set(p.user, (totals.get(p.user) ?? 0) + p.amountUsd);
    return [...totals].map(([user, usdc]) => ({ user, usdc }));
  },
});
