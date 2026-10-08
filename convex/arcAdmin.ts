// The admin panel's backend read (app/api/admin/overview): markets, the oracle queue, users, money owed, job
// heartbeats and which settings and keys are present. Read-only. Callable only with the admin secret (MIMIR_ADMIN_SECRET), which the
// site's admin route holds; key values never leave this function, only whether they are set (and how many).
import { secretMatches } from "../lib/internal-secrets";
import { privateKeyToAccount } from "viem/accounts";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/** A scheduled job says it started (crons.ts jobs call this first thing). */
export const beat = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const row = await ctx.db.query("arcHeartbeats").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (row) await ctx.db.patch(row._id, { at: Date.now() });
    else await ctx.db.insert("arcHeartbeats", { name, at: Date.now() });
  },
});

const DISPUTE_BOND = 2n * 10n ** 18n;
const FINAL = new Set(["resolved", "cancelled"]);
const keyCount = (name: string) => (process.env[name] ?? "").split(/[,\s]+/).filter(Boolean).length;
const flag = (name: string) => process.env[name]?.trim() ?? null;

function jsonEnv<T>(name: string): T | null {
  try {
    return JSON.parse(process.env[name] ?? "null") as T | null;
  } catch {
    return null;
  }
}

export const overview = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    if (!secretMatches("admin", secret)) throw new Error("not allowed");
    const now = Math.floor(Date.now() / 1000);

    // Every read is bounded (Convex caps one query at ~16k documents): the newest rows of each table, with `capped`
    // telling the panel when a total is a lower bound. Fees come from FeeAccrued events only (by_name index).
    const CAP = { markets: 3000, positions: 4000, fees: 3000, verdicts: 1000, tries: 300, takes: 1000, decisions: 1000 };
    const [markets, positions, events, verdicts, tries, takes, decisions, heartbeats, cursor] = await Promise.all([
      ctx.db.query("arcMarkets").order("desc").take(CAP.markets),
      ctx.db.query("arcPositions").order("desc").take(CAP.positions),
      ctx.db.query("arcEvents").withIndex("by_name", (q) => q.eq("name", "FeeAccrued")).order("desc").take(CAP.fees),
      ctx.db.query("arcVerdicts").order("desc").take(CAP.verdicts),
      ctx.db.query("arcOracleTries").order("desc").take(CAP.tries),
      ctx.db.query("arcMarketTakes").order("desc").take(CAP.takes),
      ctx.db.query("arcCouncilDecisions").order("desc").take(CAP.decisions),
      ctx.db.query("arcHeartbeats").take(50),
      ctx.db.query("arcCursor").withIndex("by_name", (q) => q.eq("name", "arc")).unique(),
    ]);
    const capped = {
      markets: markets.length >= CAP.markets,
      positions: positions.length >= CAP.positions,
      fees: events.length >= CAP.fees,
      verdicts: verdicts.length >= CAP.verdicts,
      takes: takes.length >= CAP.takes,
    };

    const creatorWallet = jsonEnv<{ address?: string }>("ARC_CREATOR_WALLET");
    const house = creatorWallet?.address?.toLowerCase() ?? null;
    const council = Object.entries(jsonEnv<Record<string, { address: string }>>("ARC_COUNCIL_WALLETS") ?? {}).map(([slug, w]) => ({ slug, address: w.address.toLowerCase() }));
    const councilSet = new Set(council.map((c) => c.address));
    const oracleKey = process.env.ARC_ORACLE_KEY?.trim();
    const oracleAddress = oracleKey && /^0x[0-9a-fA-F]{64}$/.test(oracleKey) ? privateKeyToAccount(oracleKey as `0x${string}`).address : null;

    const key = (k: string, id: number) => `${k}:${id}`;
    const byKey = new Map(markets.map((m) => [key(m.kind, m.marketId), m]));
    const posByMarket = new Map<string, typeof positions>();
    for (const p of positions) {
      const k = key(p.kind, p.marketId);
      posByMarket.set(k, [...(posByMarket.get(k) ?? []), p]);
    }

    // Counts by kind and state, plus "refundable": undecided or disputed past the 7-day grace.
    const counts: Record<string, Record<string, number>> = { vs: {}, pool: {} };
    const owed = { vs: 0n, pool: 0n };
    for (const m of markets) {
      const c = counts[m.kind];
      c[m.status] = (c[m.status] ?? 0) + 1;
      if (!FINAL.has(m.status) && m.refundAt > 0 && m.refundAt <= now) c.refundable = (c.refundable ?? 0) + 1;
      // What the contract still holds for this market: every stake until it is final (plus a dispute bond), then
      // for a pool the unclaimed share. VS pays at settlement, so a final VS market holds nothing here.
      const pot = BigInt(m.stakeA) + BigInt(m.stakeB);
      if (!FINAL.has(m.status)) owed[m.kind] += pot + (m.status === "disputed" ? DISPUTE_BOND : 0n);
      else if (m.kind === "pool") {
        const legs = (posByMarket.get(key(m.kind, m.marketId)) ?? []).filter((p) => !p.claimed);
        const contested = BigInt(m.stakeA) > 0n && BigInt(m.stakeB) > 0n;
        if (contested && (m.winner === 1 || m.winner === 2)) {
          const winStake = m.winner === 1 ? BigInt(m.stakeA) : BigInt(m.stakeB);
          const unclaimed = legs.filter((p) => p.side === m.winner).reduce((s, p) => s + BigInt(p.amount), 0n);
          if (winStake > 0n) owed.pool += (unclaimed * pot) / winStake;
        } else owed.pool += legs.reduce((s, p) => s + BigInt(p.amount), 0n);
      }
    }

    const verdictOf = new Map(verdicts.map((x) => [key(x.kind, x.marketId), x]));
    const takeOf = new Map(takes.map((t) => [key(t.kind, t.marketId), t]));
    const row = (m: (typeof markets)[number]) => ({
      kind: m.kind,
      marketId: m.marketId,
      question: m.question,
      category: m.category,
      status: m.status,
      creator: m.creator,
      creatorRole: m.creator.toLowerCase() === house ? "house" : councilSet.has(m.creator.toLowerCase()) ? "council" : "user",
      deadline: m.deadline,
      disputableUntil: m.disputableUntil,
      refundAt: m.refundAt,
      stakeA: m.stakeA,
      stakeB: m.stakeB,
      participants: m.participants,
      winner: m.winner,
      hasTake: takeOf.has(key(m.kind, m.marketId)),
    });

    const live = markets.filter((m) => !FINAL.has(m.status)).sort((a, b) => a.deadline - b.deadline).slice(0, 200).map(row);
    const settled = markets
      .filter((m) => FINAL.has(m.status))
      .sort((a, b) => b.updatedBlock - a.updatedBlock)
      .slice(0, 25)
      .map((m) => {
        const vd = verdictOf.get(key(m.kind, m.marketId));
        return { ...row(m), confidence: vd?.confidence ?? null, summary: (vd?.summary ?? m.summary).slice(0, 200), txHash: vd?.txHash ?? null };
      });
    const queue = tries
      .map((t) => {
        const m = byKey.get(key(t.kind, t.marketId));
        return { kind: t.kind, marketId: t.marketId, attempts: t.attempts, notBefore: t.notBefore, lastError: t.lastError?.slice(0, 300) ?? null, question: m?.question ?? "", status: m?.status ?? null };
      })
      .filter((t) => t.status !== "resolved" && t.status !== "cancelled");
    // Past the deadline and waiting on the oracle (VS needs a challenger to be decided; a pool needs nothing).
    const waiting = markets.filter((m) => m.deadline <= now && (m.kind === "vs" ? m.status === "active" : m.status === "open")).length;

    const users = new Set(positions.map((p) => p.user));
    const people = [...users].filter((u) => u !== house && !councilSet.has(u) && u !== oracleAddress?.toLowerCase());
    const fees = events.filter((e) => e.name === "FeeAccrued").reduce((s, e) => s + BigInt(e.amount ?? "0"), 0n);
    const decisionCounts: Record<string, number> = {};
    for (const d of decisions) decisionCounts[d.outcome] = (decisionCounts[d.outcome] ?? 0) + 1;
    const dayAgo = Date.now() - 86_400_000;

    return {
      now,
      capped,
      cursorBlock: cursor?.block ?? null,
      heartbeats: heartbeats.filter((h) => h.name !== "arc-poke").map((h) => ({ name: h.name, at: h.at })),
      markets: {
        total: markets.length,
        counts,
        byRole: {
          house: markets.filter((m) => m.creator.toLowerCase() === house).length,
          council: markets.filter((m) => councilSet.has(m.creator.toLowerCase())).length,
          user: markets.filter((m) => m.creator.toLowerCase() !== house && !councilSet.has(m.creator.toLowerCase())).length,
        },
        createdLast24h: markets.filter((m) => m.createdAt * 1000 > dayAgo).length,
        volumeUsd: markets.reduce((s, m) => s + m.volumeUsd, 0),
        feesWei: fees.toString(),
        live,
        settled,
      },
      oracle: { address: oracleAddress, verdicts: verdicts.length, waiting, deferred: queue },
      council: { wallets: council, takes: takes.length, takesLast24h: takes.filter((t) => t.at > dayAgo).length, decisions: decisionCounts },
      people: { arcAccounts: users.size, nonHouse: people.length, positions: positions.length },
      owedWei: { vs: owed.vs.toString(), pool: owed.pool.toString() },
      house,
      settings: {
        COUNCIL_BETS: flag("COUNCIL_BETS"),
        COUNCIL_COMMENTS: flag("COUNCIL_COMMENTS"),
        COUNCIL_TAKES_PER_CREATOR_DAY: flag("COUNCIL_TAKES_PER_CREATOR_DAY"),
        MIMIR_PAUSE_ORACLE_SETTLEMENT: flag("MIMIR_PAUSE_ORACLE_SETTLEMENT"),
        MIMIR_PAUSE_COUNCIL: flag("MIMIR_PAUSE_COUNCIL"),
        CREATOR_DAILY_BUDGET_USDC: flag("CREATOR_DAILY_BUDGET_USDC"),
        TELEGRAM_EVENTS_URL: process.env.TELEGRAM_EVENTS_URL ? "set" : null,
      },
      // Presence only: how many keys each variable holds, never the values.
      keys: Object.fromEntries(
        [
          "ORACLE_GEMINI_API_KEY", "ORACLE_ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GEMINI_API_KEYS", "COUNCIL_GEMINI_API_KEY",
          "CREATOR_GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "GROQ_API_KEYS", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY",
          "ARC_ORACLE_KEY", "CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "MIMIR_STORE_SECRET", "MIMIR_EVENTS_SECRET", "MIMIR_ADMIN_SECRET", "MIMIR_INTERNAL_SECRET",
        ].map((k) => [k, keyCount(k)]),
      ),
    };
  },
});
