import type { Candidate } from "../launch/ports";
import type { MarketRules, MarketView } from "../launch/markets";
import type { RiskParams, StrategyConfig } from "../launch/types";
import type { StrategySnapshot } from "../launch/strategy-manifest";

export const DEMO = {
  sessionMs: 7 * 86_400_000,
  maxAgents: 3,
  maxBaskets: 3,
  maxActiveAgents: 50,
  tickMs: 5 * 60_000,
  maxOpen: 3,
  history: 100,
  initialNative: 10,
  initialUsdc: 1_000,
  marketEntryFeeBps: 50,
  aiCallsPerDay: 120,
  aiCallsPerHour: 10,
  agentAiCallsPerDay: 6,
  showcaseAiCallsPerHour: 4,
  showcaseAiCallsPerDay: 30,
  chartTokens: 6,
  chartPoints: 144,
} as const;

export type DemoChain = "solana" | "arc" | "robinhood";
export type DemoStatus = "live" | "paused" | "killed" | "expired";
export type DemoConfig = {
  trading: { enabled: boolean; config: StrategyConfig | null; risk: RiskParams | null };
  markets: { enabled: boolean; rules: MarketRules; budgetUsdc: number };
};
export type DemoPosition = {
  mint: string; symbol: string; quantity: number; cost: number;
  entryPrice: number; highPrice: number; price: number; openedAt: number;
};
export type DemoTrade = {
  at: number; side: "buy" | "sell"; mint: string; symbol: string;
  amount: number; price: number; pnl: number; reason: string;
};
export type DemoEvent = { at: number; kind: string; text: string };
export type DemoPricePoint = { at: number; price: number };
export type DemoPriceHistory = { mint: string; symbol: string; points: DemoPricePoint[] };
export type DemoState = {
  cash: number; usdc: number; pnl: number; marketPnl: number;
  day: number; dailyPnl: number; dayBankroll: number;
  positions: DemoPosition[]; trades: DemoTrade[]; events: DemoEvent[];
  /** Observed shared-feed quotes only. Optional for previews created before chart tracking. */
  priceHistory?: DemoPriceHistory[];
};
export type DemoAgent = DemoConfig & {
  id: string; name: string; ticker: string; avatarSeed: string; thesis: string;
  chain: DemoChain; status: DemoStatus; createdAt: number; expiresAt: number;
  nextTickAt: number; state: DemoState;
  showcaseKey?: string;
  strategy?: StrategySnapshot;
};
export type DemoStake = {
  id: string; agentId: string; agentName: string; agentSeed: string;
  kind: "pool"; marketId: number; question: string; side: 1 | 2; label: string;
  amount: number; p: number; edge: number; why: string; at: number;
  status: "open" | "won" | "lost" | "refunded"; payout: number;
  /** Odds recorded at entry; paper fills never change the real pool. */
  same: number; other: number;
};
export type DemoBasket = {
  id: string; name: string; thesis: string; createdAt: number;
  members: { agentId: string; weightBps: number }[];
};
export type DemoFeed = {
  at: number; solana: Candidate[]; robinhood: Candidate[];
  markets: MarketView[];
};

export function initialDemoState(now: number): DemoState {
  return { cash: DEMO.initialNative, usdc: DEMO.initialUsdc, pnl: 0, marketPnl: 0,
    day: Math.floor(now / 86_400_000), dailyPnl: 0, dayBankroll: DEMO.initialNative,
    positions: [], trades: [], events: [{ at: now, kind: "launch", text: "Preview started with virtual funds. No wallet or token was created." }] };
}

export function nativeEquity(state: DemoState): number {
  return state.cash + state.positions.reduce((sum, p) => sum + p.quantity * p.price, 0);
}

/** Two independently funded sleeves: token trading and markets, weighted equally when both are enabled. */
export function demoReturn(agent: Pick<DemoAgent, "trading" | "markets" | "state">, openStake = 0): number {
  const returns: number[] = [];
  if (agent.trading.enabled) returns.push(nativeEquity(agent.state) / DEMO.initialNative - 1);
  if (agent.markets.enabled) returns.push((agent.state.usdc + openStake) / DEMO.initialUsdc - 1);
  return returns.length ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
}
