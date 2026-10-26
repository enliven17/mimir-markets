import type { Candidate } from "../launch/ports";
import { DEMO, type DemoState, type DemoPricePoint, type DemoTrade } from "./types";

const positive = (p: number) => Number.isFinite(p) && p > 0;
export const tradeKey = (t: DemoTrade) => `${t.at}:${t.mint}:${t.side}`;

/** Reuse the worker's existing price feed. No chart requests, AI calls or invented historical prices. */
export function recordDemoPrices(state: DemoState, candidates: readonly Candidate[], quotedAt: number, chartPoints: number = DEMO.chartPoints): void {
  if (!Number.isFinite(quotedAt) || quotedAt <= 0) return;
  const tokens = new Map<string, string>();
  for (const t of [...state.positions, ...state.trades]) if (!tokens.has(t.mint)) tokens.set(t.mint, t.symbol);
  const prices = new Map(candidates.filter((c) => positive(c.priceSol ?? 0)).map((c) => [c.mint, c.priceSol!]));
  state.priceHistory = [...tokens].slice(0, DEMO.chartTokens).map(([mint, symbol]) => {
    const points = [...(state.priceHistory?.find((s) => s.mint === mint)?.points ?? [])];
    const price = prices.get(mint);
    if (price && quotedAt > (points.at(-1)?.at ?? 0)) points.push({ at: quotedAt, price });
    return { mint, symbol, points: points.slice(-Math.min(864, Math.max(DEMO.chartPoints, Math.floor(chartPoints)))) };
  });
}

export function demoTokenCharts(state: DemoState) {
  const tokens = new Map<string, string>();
  for (const t of [...state.positions, ...state.trades, ...(state.priceHistory ?? [])]) if (!tokens.has(t.mint)) tokens.set(t.mint, t.symbol);
  return [...tokens].map(([mint, symbol]) => {
    const trades = state.trades.filter((t) => t.mint === mint && positive(t.price)).sort((a, b) => a.at - b.at);
    const raw = state.priceHistory?.find((s) => s.mint === mint)?.points ?? [];
    const points = [...new Map(raw.filter((p) => positive(p.price) && Number.isFinite(p.at)).map((p) => [p.at, p])).values()].sort((a, b) => a.at - b.at);
    return { mint, symbol, points, trades, position: state.positions.find((p) => p.mint === mint) };
  });
}
export type DemoTokenChart = ReturnType<typeof demoTokenCharts>[number];

export function chartWindow(token: DemoTokenChart, hours: number | null) {
  const all: DemoPricePoint[] = [...token.points, ...token.trades.map(({ at, price }) => ({ at, price }))];
  const latest = all.reduce((max, p) => Math.max(max, p.at), 0);
  const cutoff = hours === null ? -Infinity : latest - hours * 3_600_000;
  return { points: token.points.filter((p) => p.at >= cutoff), trades: token.trades.filter((t) => t.at >= cutoff) };
}

export const chartPrice = (price: number, digits = 4) => Number.isFinite(price)
  ? price.toLocaleString("en-US", { maximumSignificantDigits: digits, useGrouping: false, notation: "standard" }) : "—";

/** Fills anchor older activity without presenting execution prices as observed market quotes. */
export function chartTimeline(visible: Pick<DemoTokenChart, "points" | "trades">) {
  const byTime = new Map<number, DemoPricePoint & { source: "quote" | "fill" }>();
  for (const t of visible.trades) byTime.set(t.at, { at: t.at, price: t.price, source: "fill" });
  // At the same timestamp the line follows the market quote, not the slippage-adjusted fill.
  for (const p of visible.points) byTime.set(p.at, { ...p, source: "quote" });
  const points = [...byTime.values()].sort((a, b) => a.at - b.at);
  const segments = points.slice(1).map((to, i) => ({ from: points[i], to,
    gap: points[i].source !== "quote" || to.source !== "quote" || to.at - points[i].at > DEMO.tickMs * 2 }));
  return { points, segments };
}
