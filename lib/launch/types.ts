/**
 * Mimir Launch: the hosted agent's strategy and risk types, ported from snipad (lib/types.ts). The Solana trading
 * side keeps snipad's shape; the Arc market side adds its own (lib/launch/markets.ts).
 */
export type Strategy = "trending" | "whale" | "sniper" | "social";

export interface RiskParams {
  slippageBps: number;
  positionPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxDailyLossPct: number;
}

export type LiveView = "public" | "holders" | "private";

export type DataSource = "dexscreener" | "pumpfun" | "helius" | "x" | "birdeye";

export type Metric = "liquidityUsd" | "volume1hUsd" | "ageMinutes" | "holders" | "devHoldPct" | "mcapUsd" | "curvePct" | "mentions1h";

export type Op = ">" | "<";

export interface Condition {
  metric: Metric;
  op: Op;
  value: number;
}

/** What the creator wrote. Rules are enforced in code; the thesis only steers the LLM's ranking. */
export interface StrategyConfig {
  preset: Strategy;
  sources: DataSource[];
  entry: Condition[];
  whales: string[];
  /** ShieldBot score (0-100) required before an automated buy. Older configs omit it and use 60. */
  minSafetyScore?: number;
  trailingStopPct: number | null;
  maxHoldMinutes: number | null;
  thesis: string;
  liveView: LiveView;
  copyTrade: boolean;
}

export const METRICS: Record<Metric, { label: string; unit: string }> = {
  liquidityUsd: { label: "Liquidity", unit: "$" },
  volume1hUsd: { label: "Volume 1h", unit: "$" },
  ageMinutes: { label: "Pair age", unit: "min" },
  holders: { label: "Holders", unit: "" },
  devHoldPct: { label: "Dev holds", unit: "%" },
  mcapUsd: { label: "Market cap", unit: "$" },
  curvePct: { label: "Curve filled", unit: "%" },
  mentions1h: { label: "X mentions 1h", unit: "" },
};
