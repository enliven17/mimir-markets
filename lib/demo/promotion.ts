import type { DemoAgent } from "./types";

/** Transfer the strategy only. Real funding, wallet creation and minting always go through live Launch. */
export function demoLiveDraft(agent: DemoAgent) {
  const trading = agent.trading;
  return {
    name: agent.name, ticker: agent.ticker, avatarSeed: agent.avatarSeed, thesis: agent.thesis, chain: agent.chain,
    markets: { ...agent.markets.rules, enabled: agent.markets.enabled, budgetUsdc: agent.markets.budgetUsdc, create: { enabled: false, perDay: 1 } },
    trading: trading.enabled && trading.config && trading.risk ? {
      enabled: true as const,
      strategy: { preset: trading.config.preset, sources: [...trading.config.sources], entry: trading.config.entry.map((c) => ({ ...c })), whales: [...trading.config.whales] },
      risk: { ...trading.risk }, trailingStopPct: trading.config.trailingStopPct ?? 0, maxHoldMinutes: trading.config.maxHoldMinutes ?? 0,
    } : { enabled: false as const },
  };
}
