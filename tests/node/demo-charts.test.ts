import { test } from "node:test";
import assert from "node:assert/strict";
import { recordDemoPrices, demoTokenCharts, chartWindow } from "../../lib/demo/charts";
import { DEMO, initialDemoState } from "../../lib/demo/types";
import type { Candidate } from "../../lib/launch/ports";

const buy = (mint = "token") => ({ at: 1_000, side: "buy" as const, mint, symbol: mint.toUpperCase(), amount: 0.5, price: 0.00103, pnl: 0, reason: "Evidence met the rules" });
const quote = (price: number, mint = "token") => ({ mint, symbol: mint.toUpperCase(), priceSol: price } as Candidate);

test("chart tracking uses observed quotes rather than slippage-adjusted fill prices and changes no balances", () => {
  const state = initialDemoState(1_000); state.trades.push(buy());
  recordDemoPrices(state, [quote(0.001)], 2_000);
  assert.deepEqual(state.priceHistory, [{ mint: "token", symbol: "TOKEN", points: [{ at: 2_000, price: 0.001 }] }]);
  assert.equal(state.cash, DEMO.initialNative); assert.equal(state.trades[0].price, 0.00103);
  recordDemoPrices(state, [quote(0.002)], 2_000);
  recordDemoPrices(state, [quote(0.003)], 1_500);
  recordDemoPrices(state, [quote(NaN)], 3_000);
  assert.equal(state.priceHistory![0].points.length, 1);
  const chart = demoTokenCharts(state)[0];
  assert.equal(chart.trades[0].price, 0.00103);
  assert.equal(chart.points[0].price, 0.001);
});

test("history is bounded by token and point ceilings without tracking unrelated candidates", () => {
  const state = initialDemoState(1_000);
  state.trades = Array.from({ length: 10 }, (_, i) => buy(`token${i}`));
  const quotes = [...state.trades.map((t) => quote(0.001, t.mint)), quote(1, "unrelated")];
  for (let i = 1; i <= DEMO.chartPoints + 20; i++) recordDemoPrices(state, quotes, i * 300_000);
  assert.equal(state.priceHistory!.length, DEMO.chartTokens);
  for (const series of state.priceHistory!) assert.equal(series.points.length, DEMO.chartPoints);
  assert.equal(state.priceHistory!.some((s) => s.mint === "unrelated"), false);
});

test("legacy previews keep their genuine buy and sell markers without fabricated quote history", () => {
  const state = initialDemoState(1_000);
  state.trades = [{ ...buy(), side: "sell", at: 10_000, price: 0.0015, pnl: 0.2 }, buy()];
  const chart = demoTokenCharts(state)[0];
  assert.deepEqual(chart.points, []);
  assert.deepEqual(chart.trades.map((t) => t.side), ["buy", "sell"]);
});

test("chart windows use the last recorded time and filter prices and fills together", () => {
  const state = initialDemoState(1_000); state.trades = [buy()];
  state.priceHistory = [{ mint: "token", symbol: "TOKEN", points: [{ at: 1_000, price: 1 }, { at: 7_201_000, price: 2 }] }];
  const chart = demoTokenCharts(state)[0];
  assert.equal(chartWindow(chart, 1).points.length, 1);
  assert.equal(chartWindow(chart, 1).trades.length, 0);
  assert.equal(chartWindow(chart, null).trades.length, 1);
});
