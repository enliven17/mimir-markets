import assert from "node:assert/strict";
import { test } from "node:test";

import { readBars, replay, rsi, summarize, type Bar } from "../../lib/launch/engine/ta";

const bar = (close: number, i: number, volume = 1): Bar => ({ time: i * 60, open: close, high: close, low: close, close, volume });
const series = (closes: number[]) => closes.map((c, i) => bar(c, i));

test("technical reads detect stretched climbs and washed out falls", () => {
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 1 + i)), 100);
  assert.ok(rsi(Array.from({ length: 30 }, (_, i) => 100 - i * 2))! < 5);
  assert.equal(rsi([1, 2, 3]), null);
  const read = readBars(series(Array.from({ length: 40 }, (_, i) => 1 + i * 0.05)))!;
  assert.equal(read.trend, "up");
  assert.ok(read.fromHighPct < 1);
  assert.ok(read.signals.some((s) => s.includes("chasing")));
});

test("replay applies stops before targets and summarizes realised native PnL", () => {
  const exits = { takeProfitPct: 50, stopLossPct: 20, trailingStopPct: 25 };
  assert.deepEqual(replay(series([1, 1.2, 1.6]), exits, 2), { returnPct: 48, reason: "take profit", heldBars: 2 });
  assert.equal(replay(series([1, 0.9, 0.7]), exits, 2)!.reason, "stop loss");
  assert.equal(replay(series([1, 1.4, 1.0]), exits, 0)!.reason, "trailing stop");
  const s = summarize([{ returnPct: 50, reason: "take profit", heldBars: 3 }, { returnPct: -20, reason: "stop loss", heldBars: 2 }, { returnPct: -10, reason: "stop loss", heldBars: 1 }], 0.1)!;
  assert.equal(s.trades, 3);
  assert.ok(Math.abs(s.profitFactor! - 50 / 30) < 1e-9);
  assert.ok(Math.abs(s.pnlNative - 0.02) < 1e-9);
  assert.ok(Math.abs(s.maxDrawdownNative - 0.03) < 1e-9);
});
