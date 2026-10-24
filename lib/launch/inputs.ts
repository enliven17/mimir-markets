import { z } from "zod";
import { DEFAULT_MARKET_RULES } from "./markets";
import { AGENT_MARKETS_PER_DAY_MAX } from "./agent-markets-limit";
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const METRICS = ["liquidityUsd", "volume1hUsd", "ageMinutes", "holders", "devHoldPct", "mcapUsd", "curvePct", "mentions1h"] as const;

export const Trading = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    strategy: z.object({
      preset: z.enum(["trending", "whale", "sniper", "social"]),
      sources: z.array(z.enum(["dexscreener", "pumpfun", "helius", "x", "birdeye"])).min(1).max(5),
      entry: z.array(z.object({ metric: z.enum(METRICS), op: z.enum([">", "<"]), value: z.number().finite().min(0) })).min(1).max(8),
      whales: z.array(z.string().regex(B58)).max(20).default([]),
    }).refine((s) => !s.sources.includes("helius") || s.whales.length > 0, { message: "Add at least one wallet to follow.", path: ["whales"] }),
    risk: z.object({
      slippageBps: z.number().int().min(50).max(1000),
      positionPct: z.number().min(1).max(25),
      stopLossPct: z.number().min(5).max(50),
      takeProfitPct: z.number().min(10).max(300),
      maxDailyLossPct: z.number().min(5).max(50),
    }),
    trailingStopPct: z.number().min(0).max(30).default(0),
    maxHoldMinutes: z.number().int().min(0).max(240).default(0),
  }),
]);

export const Markets = z.object({
  enabled: z.boolean(),
  categories: z.array(z.string().trim().min(1).max(20)).max(12).default([]),
  minEdge: z.number().min(0.03).max(0.5).default(DEFAULT_MARKET_RULES.minEdge),
  kellyFraction: z.number().min(0.05).max(1).default(DEFAULT_MARKET_RULES.kellyFraction),
  maxStakeUsdc: z.number().min(0.1).max(50).default(DEFAULT_MARKET_RULES.maxStakeUsdc),
  maxHoursToClose: z.number().min(1).max(24 * 30).default(DEFAULT_MARKET_RULES.maxHoursToClose),
  /** The most it may have staked at once. */
  budgetUsdc: z.number().min(0).max(10_000).default(20),
  /** Opening its own markets (lib/launch/agent-markets.ts): off by default; gas and the seed stake from its Arc wallet. */
  create: z.object({ enabled: z.boolean(), perDay: z.number().int().min(1).max(AGENT_MARKETS_PER_DAY_MAX) }).default({ enabled: false, perDay: 1 }),
});
