import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertMarketDeployment } from "./marketDeploymentGuard";
import { assertSameDeployment, marketDeployment } from "../lib/chains/deployment";
import { serverMarketChains } from "../lib/chains/registry";
import { vChain } from "./schema";

export const check = internalQuery({
  args: {},
  handler: async (ctx) => { await assertMarketDeployment(ctx); return true; },
});

/** Authenticated CLI only. No reset/rebind endpoint: moving networks requires another Convex deployment. */
export const bind = internalMutation({
  args: { chain: vChain, adoptExistingTestnet: v.optional(v.boolean()) },
  handler: async (ctx, { chain, adoptExistingTestnet }) => {
    const cfg = serverMarketChains().chains[chain];
    if (!cfg.enabled) throw new Error("Enable and configure the chain before binding it");
    const expected = marketDeployment(cfg);
    const stored = await ctx.db.query("marketDeployments").withIndex("by_chain", (q) => q.eq("chain", chain)).unique();
    if (stored) { assertSameDeployment(stored, expected); return expected; }
    // There is no reliable way to infer a legacy row's network from its market ID. Never adopt it on mainnet.
    const tables = ["arcMarkets", "arcPositions", "arcEvents", "arcVerdicts", "arcOracleTries", "arcCouncilDecisions", "arcMarketTakes", "arcTriage", "councilOpinions", "launchStakes"] as const;
    let hasData = false;
    for (const table of tables) {
      if (await ctx.db.query(table).withIndex("by_market", (q) => q.eq("chain", chain)).first()) hasData = true;
    }
    if (await ctx.db.query("arcCursor").withIndex("by_name", (q) => q.eq("name", chain)).first()) hasData = true;
    if (cfg.network === "mainnet") {
      // A fresh mainnet environment must also leave testnet agent wallets, tokens and permissions behind.
      if (await ctx.db.query("launchAgents").first() || await ctx.db.query("appStore").first()) hasData = true;
    }
    if (hasData && !(cfg.network === "testnet" && adoptExistingTestnet === true)) {
      throw new Error("Existing unbound data: mainnet requires a clean Convex deployment; legacy testnet adoption must be explicit");
    }
    await ctx.db.insert("marketDeployments", { ...expected, chain, boundAt: Date.now() });
    return expected;
  },
});
