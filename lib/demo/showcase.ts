import { PRESETS, RH_PRESETS } from "../launch/presets";
import { DemoCreateBody } from "./input";
import { DEMO, initialDemoState, type DemoAgent } from "./types";
import { DEFAULT_MARKET_RULES } from "../launch/markets";

const risk = { slippageBps: 300, positionPct: 5, stopLossPct: 15, takeProfitPct: 40, maxDailyLossPct: 20 };
const markets = { enabled: true, categories: [] as string[], budgetUsdc: 50, maxStakeUsdc: 5 };

/** Fixed house examples. They share the deployment's demo AI budget and never consume a guest's allowance. */
export const SHOWCASE_AGENTS = [
  { key: "scout", input: { name: "Mimir Scout", ticker: "SCOUT", chain: "solana", thesis: "Look for liquid, actively traded Solana tokens with sustained volume. Avoid weak liquidity and uncertain momentum.", trading: { enabled: true, strategy: { preset: "trending", ...PRESETS.trending }, risk }, markets: { ...markets, categories: ["crypto"] } } },
  { key: "sentinel", input: { name: "Mimir Sentinel", ticker: "SENTINEL", chain: "solana", thesis: "Prioritize capital preservation. Only rank highly liquid tokens with convincing volume and a conservative thesis.", trading: { enabled: true, strategy: { preset: "trending", ...PRESETS.trending, entry: [{ metric: "liquidityUsd", op: ">", value: 100_000 }, { metric: "volume1hUsd", op: ">", value: 200_000 }] }, risk: { ...risk, positionPct: 3, stopLossPct: 10, takeProfitPct: 30, maxDailyLossPct: 10 }, trailingStopPct: 10 }, markets: { enabled: false } } },
  { key: "value", input: { name: "Mimir Value", ticker: "VALUE", chain: "arc", thesis: "Look for mispriced prediction markets supported by clear, verifiable evidence. Be conservative when an outcome is uncertain.", trading: { enabled: false }, markets: { ...markets, minEdge: 0.1, kellyFraction: 0.15 } } },
  { key: "matchday", input: { name: "Mimir Matchday", ticker: "MATCHDAY", chain: "arc", thesis: "Evaluate sports markets using team strength and reliable evidence. Avoid coin flips and unsupported certainty.", trading: { enabled: false }, markets: { ...markets, categories: ["sports"], minEdge: 0.08, kellyFraction: 0.25 } } },
  { key: "pioneer", input: { name: "Mimir Pioneer", ticker: "PIONEER", chain: "robinhood", thesis: "Prefer Pons tokens with real trading volume and liquidity on Robinhood Chain. Rank speculative launches conservatively.", trading: { enabled: true, strategy: { preset: "trending", ...RH_PRESETS.trending }, risk }, markets: { ...markets, categories: ["crypto", "tech"] } } },
].map(({ key, input }) => ({ key, input: DemoCreateBody.parse(input) }));

/** Available immediately while the backend's first paper evaluation is preparing. */
export function showcasePreviews(): DemoAgent[] {
  return SHOWCASE_AGENTS.map(({ key, input: b }) => {
    const t = b.trading, now = Date.now();
    return { id: `preview-${key}`, name: b.name, ticker: b.ticker, avatarSeed: b.ticker.toLowerCase(), thesis: b.thesis,
      showcaseKey: key, chain: b.chain, status: "live", createdAt: now, expiresAt: now + DEMO.sessionMs, nextTickAt: now,
      trading: t.enabled ? { enabled: true, config: { ...t.strategy, trailingStopPct: t.trailingStopPct || null, maxHoldMinutes: t.maxHoldMinutes || null, thesis: b.thesis, liveView: "public", copyTrade: false }, risk: t.risk } : { enabled: false, config: null, risk: null },
      markets: { enabled: b.markets.enabled, budgetUsdc: b.markets.budgetUsdc, rules: { ...DEFAULT_MARKET_RULES, ...b.markets } },
      state: initialDemoState(now) };
  });
}
