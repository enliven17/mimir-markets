/**
 * Technical reads and deterministic strategy replay for launch agents.
 *
 * The worker never lets these reads override hard entry rules. They are a
 * second opinion for ranking and a way to test exit settings against the same
 * candle shape the live worker sees.
 */
import { exitDecision } from "./exits";

export type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

export function ema(values: number[], period: number): number[] {
  if (!Number.isInteger(period) || period <= 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  for (const [i, value] of values.entries()) out.push(i === 0 ? value : value * k + out[i - 1]! * (1 - k));
  return out;
}

/** Wilder's RSI; null until there are `period` changes. */
export function rsi(closes: number[], period = 14): number | null {
  if (!Number.isInteger(period) || period <= 0 || closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

export type TechnicalRead = {
  bars: number;
  price: number;
  changePct: number;
  fromHighPct: number;
  trend: "up" | "down" | "flat";
  rsi: number | null;
  volumeSpike: number | null;
  vsVwapPct: number | null;
  signals: string[];
};

/** Read EMA trend, RSI, volume, VWAP and distance from the recent high in plain words. */
export function readBars(bars: Bar[]): TechnicalRead | null {
  if (bars.length < 5) return null;
  const closes = bars.map((b) => b.close).filter((v) => Number.isFinite(v) && v > 0);
  if (closes.length !== bars.length) return null;
  const price = closes.at(-1)!;
  const high = Math.max(...bars.map((b) => b.high));
  if (!(high > 0)) return null;
  const fast = ema(closes, 9).at(-1)!;
  const slow = ema(closes, 21).at(-1)!;
  const trend = fast > slow * 1.01 ? "up" : fast < slow * 0.99 ? "down" : "flat";
  const r = rsi(closes);
  const prior = bars.slice(-21, -1);
  const avgVol = prior.length ? prior.reduce((total, b) => total + Math.max(0, b.volume), 0) / prior.length : 0;
  const volumeSpike = avgVol > 0 ? Math.max(0, bars.at(-1)!.volume) / avgVol : null;
  const volume = bars.reduce((total, b) => total + Math.max(0, b.volume), 0);
  const vwap = volume > 0 ? bars.reduce((total, b) => total + ((b.high + b.low + b.close) / 3) * Math.max(0, b.volume), 0) / volume : null;
  const read: TechnicalRead = {
    bars: bars.length,
    price,
    changePct: (price / bars[0]!.open - 1) * 100,
    fromHighPct: (1 - price / high) * 100,
    trend,
    rsi: r,
    volumeSpike,
    vsVwapPct: vwap && vwap > 0 ? (price / vwap - 1) * 100 : null,
    signals: [],
  };
  if (trend === "up") read.signals.push("Short average above the long one: buyers in control.");
  if (trend === "down") read.signals.push("Short average under the long one: sellers in control.");
  if (r !== null && r >= 75) read.signals.push(`RSI ${r.toFixed(0)}: stretched, a pullback is likely before more upside.`);
  if (r !== null && r <= 30) read.signals.push(`RSI ${r.toFixed(0)}: washed out, sellers may be done.`);
  if (volumeSpike !== null && volumeSpike >= 3) read.signals.push(`Volume ${volumeSpike.toFixed(1)}x the recent average on the last candle.`);
  if (read.fromHighPct >= 50) read.signals.push(`${read.fromHighPct.toFixed(0)}% below its high: it already dumped once.`);
  else if (read.fromHighPct <= 5 && read.changePct > 20) read.signals.push("At its high after a run: chasing here is the risky entry.");
  if (read.vsVwapPct !== null && Math.abs(read.vsVwapPct) >= 15) read.signals.push(`${read.vsVwapPct > 0 ? "Above" : "Below"} its average traded price by ${Math.abs(read.vsVwapPct).toFixed(0)}%.`);
  return read;
}

export type Replay = { returnPct: number; reason: "take profit" | "stop loss" | "trailing stop" | "max hold" | "still open"; heldBars: number };

export type ReplayExits = {
  takeProfitPct?: number | null;
  stopLossPct?: number | null;
  trailingStopPct?: number | null;
  maxHoldMinutes?: number | null;
};

/** Replay the live exit order candle by candle. Stops are checked before targets on a shared candle. */
export function replay(bars: Bar[], exits: ReplayExits, costPct: number, skipBars = 0): Replay | null {
  const entryBar = bars[skipBars];
  if (!entryBar || !(entryBar.close > 0)) return null;
  const entry = entryBar.close;
  let peak = entry;
  for (let i = skipBars + 1; i < bars.length; i++) {
    const b = bars[i]!;
    const points: Array<[number, number]> = [[b.low, b.time], [b.high, b.time], [b.close, b.time]];
    for (const [price, at] of points) {
      const decision = exitDecision({
        position: { entryPrice: entry, highPrice: peak, openedAt: bars[skipBars]!.time * 1000 },
        price,
        risk: { stopLossPct: exits.stopLossPct ?? 0, takeProfitPct: exits.takeProfitPct ?? 0 },
        config: { trailingStopPct: exits.trailingStopPct ?? null, maxHoldMinutes: exits.maxHoldMinutes ?? null },
        now: at * 1000,
      });
      if (decision.action === "sell") {
        const target = decision.kind === "take_profit"
          ? entry * (1 + (exits.takeProfitPct ?? 0) / 100)
          : decision.kind === "stop_loss"
            ? entry * (1 - (exits.stopLossPct ?? 0) / 100)
            : decision.kind === "trailing_stop"
              ? peak * (1 - (exits.trailingStopPct ?? 0) / 100)
              : price;
        const reason = decision.kind === "take_profit" ? "take profit" : decision.kind === "stop_loss" ? "stop loss" : decision.kind === "trailing_stop" ? "trailing stop" : "max hold";
        return { returnPct: (target / entry - 1) * 100 - costPct, reason, heldBars: i - skipBars };
      }
      peak = Math.max(peak, price);
    }
  }
  return { returnPct: (bars.at(-1)!.close / entry - 1) * 100 - costPct, reason: "still open", heldBars: bars.length - 1 - skipBars };
}

export type BacktestSummary = { trades: number; wins: number; winRatePct: number; avgReturnPct: number; medianReturnPct: number; bestPct: number; worstPct: number; profitFactor: number | null; pnlNative: number; maxDrawdownNative: number };

export function summarize(results: Replay[], sizeNative: number): BacktestSummary | null {
  if (!results.length) return null;
  const returns = results.map((x) => x.returnPct);
  const sorted = [...returns].sort((a, b) => a - b);
  const wins = returns.filter((x) => x > 0);
  const losses = returns.filter((x) => x <= 0);
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const change of returns) {
    equity += (sizeNative * change) / 100;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  const lossSum = -losses.reduce((total, value) => total + value, 0);
  return {
    trades: returns.length,
    wins: wins.length,
    winRatePct: (wins.length / returns.length) * 100,
    avgReturnPct: returns.reduce((a, b) => a + b, 0) / returns.length,
    medianReturnPct: sorted[Math.floor(sorted.length / 2)]!,
    bestPct: sorted.at(-1)!,
    worstPct: sorted[0]!,
    profitFactor: lossSum > 0 ? wins.reduce((a, b) => a + b, 0) / lossSum : null,
    pnlNative: equity,
    maxDrawdownNative: drawdown,
  };
}
