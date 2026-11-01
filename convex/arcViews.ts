// Read-only views for the market UI that span tables: the council roster (each persona's wallets, record and recent
// stakes) and the oracle's totals. Wallet addresses come from ARC_COUNCIL_WALLETS / BASE_COUNCIL_WALLETS (public
// addresses, no secrets).
import { privateKeyToAccount } from "viem/accounts";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { councilWallets, oracleKey } from "../lib/chains/house";
import { serverMarketChains } from "../lib/chains/registry";

const VERDICT_COUNT_CAP = 5000;

/** Every persona with a wallet on any chain: its Arc address (else Base), record on settled markets, money at risk, last stakes. */
export const council = query({
  args: {},
  handler: async (ctx) => {
    const out = [];
    const enabled = serverMarketChains().enabled;
    const arc = enabled.includes("arc") ? councilWallets("arc") : {};
    const base = enabled.includes("base") ? councilWallets("base") : {};
    for (const slug of [...new Set([...Object.keys(arc), ...Object.keys(base)])]) {
      const addresses = [base[slug]?.address, arc[slug]?.address].filter((a): a is `0x${string}` => Boolean(a)).map((a) => a.toLowerCase());
      const address = addresses[0];
      const positions = [];
      for (const a of new Set(addresses)) positions.push(...(await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", a)).order("desc").take(300)));
      let won = 0;
      let lost = 0;
      let atRisk = 0n;
      const bets = [];
      for (const p of positions) {
        const chain = p.chain ?? "arc";
        if (!enabled.includes(chain)) continue;
        const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("chain", chain).eq("kind", p.kind).eq("marketId", p.marketId)).unique();
        if (!m) continue;
        const settled = m.status === "resolved" || m.status === "cancelled";
        if (!settled) atRisk += BigInt(p.amount);
        else if (m.winner === p.side) won++;
        else if (m.winner === 1 || m.winner === 2) lost++;
        bets.push({ chain, kind: p.kind, marketId: p.marketId, amount: p.amount, question: m.question, createdAt: m.createdAt });
      }
      bets.sort((a, b) => b.createdAt - a.createdAt);
      out.push({ slug, address, base: base[slug]?.address.toLowerCase() ?? null, stakes: positions.length, won, lost, atRisk: atRisk.toString(), recentBets: bets.slice(0, 5) });
    }
    return out;
  },
});

/** The oracle's address (one key, the same address on every chain) and how many verdicts it has published. */
export const oracle = query({
  args: {},
  handler: async (ctx) => {
    // Only the public address leaves this function.
    const key = oracleKey();
    const address = key ? privateKeyToAccount(key).address : null;
    // Bounded count: past VERDICT_COUNT_CAP the page shows "N+".
    const enabled = serverMarketChains().enabled;
    const verdicts = (await ctx.db.query("arcVerdicts").take(VERDICT_COUNT_CAP)).filter((r) => enabled.includes(r.chain ?? "arc"));
    return { address, base: address, verdicts: verdicts.length, capped: verdicts.length >= VERDICT_COUNT_CAP };
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
    const seen = new Set<string>();
    const out = [];
    for (const w of wallets.slice(0, 50)) {
      const legs = await ctx.db.query("arcPositions").withIndex("by_user", (q) => q.eq("user", w.toLowerCase())).order("desc").take(400);
      for (const leg of legs) {
        const chain = leg.chain ?? "arc";
        const key = `${chain}:${leg.marketId}`;
        if (leg.kind !== "vs" || leg.side !== 2 || seen.has(key)) continue;
        const m = await ctx.db.query("arcMarkets").withIndex("by_market", (q) => q.eq("chain", chain).eq("kind", "vs").eq("marketId", leg.marketId)).unique();
        if (!m || m.isPrivate || !want.has(m.status)) continue;
        seen.add(key);
        const positions = await ctx.db.query("arcPositions").withIndex("by_market", (q) => q.eq("chain", chain).eq("kind", "vs").eq("marketId", leg.marketId)).take(500);
        out.push({ ...m, chain, positions: positions.map((p) => ({ user: p.user, side: p.side, amount: p.amount })) });
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, Math.min(limit ?? 200, 1000));
  },
});

/** Total staked per Arc address (gross of nothing: the net stakes the index holds), for the campaign board. */
export const volumeByUser = query({
  args: {},
  handler: async (ctx) => {
    // ponytail: bounded scan of the newest 12k positions per board refresh (the route caches 60s); an aggregate table past that.
    // Money that came straight back scores nothing: cancelled markets, and settled ones that refunded everyone (a draw,
    // unresolvable, a one-sided pool), so opening and cancelling markets cannot farm points.
    const refunded = new Set<string>();
    const key = (r: { chain?: string; kind: string; marketId: number }) => `${r.chain ?? "arc"}:${r.kind}:${r.marketId}`;
    for (const m of await ctx.db.query("arcMarkets").withIndex("by_status_deadline", (q) => q.eq("status", "cancelled")).take(5000)) refunded.add(key(m));
    for (const m of await ctx.db.query("arcMarkets").withIndex("by_status_deadline", (q) => q.eq("status", "resolved")).take(5000))
      if (m.winner !== 1 && m.winner !== 2) refunded.add(key(m));
    const totals = new Map<string, number>();
    for (const p of await ctx.db.query("arcPositions").order("desc").take(12_000))
      if (!refunded.has(key(p))) totals.set(p.user, (totals.get(p.user) ?? 0) + p.amountUsd);
    return [...totals].map(([user, usdc]) => ({ user, usdc }));
  },
});

const STATE = { open: 0, active: 1, resolved: 2, cancelled: 3, proposed: 4, disputed: 5 } as const;
/** 18-dp wei (string) → 6-dp USDC units, as the stats page formats them. */
const usdcUnits = (wei: string) => (BigInt(wei) / 1_000_000_000_000n).toString();

/**
 * /stats: every public market in the old claim-feed shape (state numbers, USDC units), with the confidence of its
 * latest verdict, plus the totals. Bounded to the newest 500 markets.
 */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const enabled = serverMarketChains().enabled;
    const rows = (await ctx.db.query("arcMarkets").order("desc").take(500)).filter((m) => !m.isPrivate && enabled.includes(m.chain ?? "arc"));
    const claims = [];
    let openPool = 0n;
    let resolved = 0;
    for (const m of rows) {
      const verdict = await ctx.db.query("arcVerdicts").withIndex("by_market", (q) => q.eq("chain", m.chain ?? "arc").eq("kind", m.kind).eq("marketId", m.marketId)).order("desc").first();
      const state = STATE[m.status as keyof typeof STATE] ?? 0;
      if (state <= 1) openPool += BigInt(m.stakeA) + BigInt(m.stakeB);
      if (state === 2) resolved++;
      claims.push({
        id: m.marketId, chain: m.chain ?? "arc", kind: m.kind, question: m.question, category: m.category,
        creatorStake: usdcUnits(m.stakeA), totalChallengerStake: usdcUnits(m.stakeB),
        state, winnerSide: m.winner, confidence: verdict?.confidence ?? 0, createdAt: m.createdAt, deadline: m.deadline,
      });
    }
    return { claims, claimCount: claims.length, totalResolved: resolved, openPool: usdcUnits(openPool.toString()) };
  },
});
