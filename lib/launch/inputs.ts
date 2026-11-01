import { z } from "zod";
import { DEFAULT_MARKET_RULES } from "./markets";
import { AGENT_MARKETS_PER_DAY_MAX } from "./agent-markets-limit";

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
