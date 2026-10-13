import { test } from "node:test";
import assert from "node:assert/strict";
import { exitDecision } from "../../lib/launch/engine/exits";
import type { ExitInput } from "../../lib/launch/engine/exits";
import { config, risk } from "../../lib/launch/engine/fixtures";

const T0 = 1_700_000_000_000;
const input = (over: Partial<ExitInput> = {}): ExitInput => ({
  position: { entryPrice: 1, highPrice: 1, openedAt: new Date(T0) },
  price: 1,
  risk: risk(),
  config: config(),
  now: T0 + 60_000,
  ...over,
});

test("holds inside the band", () => {
  const d = exitDecision(input({ price: 1.1 }));
  assert.equal(d.action, "hold");
  assert.equal(d.high, 1.1);
});

test("stop-loss at exactly -15%", () => {
  const d = exitDecision(input({ price: 0.85 }));
  assert.equal(d.action, "sell");
  assert.equal(d.kind, "stop_loss");
  assert.equal(d.fraction, 1);
  assert.match(d.reason, /SL -15%/);
});

test("take-profit at +50%", () => {
  const d = exitDecision(input({ price: 1.5 }));
  assert.equal(d.kind, "take_profit");
});

test("trailing stop after a new high", () => {
  const cfg = config({ trailingStopPct: 10 });
  const up = exitDecision(input({ price: 1.4, config: cfg }));
  assert.equal(up.action, "hold");
  assert.equal(up.high, 1.4);
  const back = exitDecision(input({ position: { entryPrice: 1, highPrice: up.high, openedAt: T0 }, price: 1.25, config: cfg }));
  assert.equal(back.kind, "trailing_stop"); // 10.7% off 1.4
  assert.equal(back.high, 1.4);
  const fine = exitDecision(input({ position: { entryPrice: 1, highPrice: 1.4, openedAt: T0 }, price: 1.3, config: cfg }));
  assert.equal(fine.action, "hold");
});

test("max hold time, with and without a price", () => {
  const cfg = config({ maxHoldMinutes: 30 });
  assert.equal(exitDecision(input({ config: cfg, now: T0 + 29 * 60_000 })).action, "hold");
  assert.equal(exitDecision(input({ config: cfg, now: T0 + 30 * 60_000 })).kind, "max_hold");
  const noPrice = exitDecision(input({ config: cfg, price: NaN, now: T0 + 31 * 60_000 }));
  assert.equal(noPrice.kind, "max_hold");
  assert.equal(noPrice.pnlPct, null);
});

test("NaN, null, zero or negative price → hold, high unchanged", () => {
  for (const price of [NaN, null, 0, -1, Infinity]) {
    const d = exitDecision(input({ price, position: { entryPrice: 1, highPrice: 1.2, openedAt: T0 } }));
    assert.equal(d.action, "hold", String(price));
    assert.equal(d.kind, "no_price");
    assert.equal(d.high, 1.2);
  }
});

test("SL wins over max hold; disabled (0) SL/TP never fire", () => {
  const d = exitDecision(input({ price: 0.5, config: config({ maxHoldMinutes: 1 }), now: T0 + 10 * 60_000 }));
  assert.equal(d.kind, "stop_loss");
  const off = exitDecision(input({ price: 0.01, risk: risk({ stopLossPct: 0, takeProfitPct: 0 }) }));
  assert.equal(off.action, "hold");
});

test("broken stored high falls back to entry", () => {
  const d = exitDecision(input({ position: { entryPrice: 1, highPrice: NaN, openedAt: T0 }, price: 1.05 }));
  assert.equal(d.high, 1.05);
});
