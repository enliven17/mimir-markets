// Shared test builders for engine/worker tests (no I/O).
import type { RiskParams, StrategyConfig } from "../types";
import type { Candidate } from "../ports";

export const MINT_A = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
export const MINT_B = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
export const MINT_C = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

export const risk = (over: Partial<RiskParams> = {}): RiskParams => ({
  slippageBps: 300,
  positionPct: 10,
  stopLossPct: 15,
  takeProfitPct: 50,
  maxDailyLossPct: 20,
  ...over,
});

export const config = (over: Partial<StrategyConfig> = {}): StrategyConfig => ({
  preset: "trending",
  sources: ["dexscreener"],
  entry: [{ metric: "liquidityUsd", op: ">", value: 50_000 }],
  whales: [],
  trailingStopPct: null,
  maxHoldMinutes: null,
  thesis: "momentum memes with real volume",
  liveView: "public",
  copyTrade: false,
  ...over,
});

export const cand = (mint: string, over: Partial<Candidate> = {}): Candidate => ({
  mint,
  symbol: "TEST",
  source: "dexscreener",
  priceSol: 0.001,
  metrics: { liquidityUsd: 100_000, volume1hUsd: 200_000 },
  ...over,
});
