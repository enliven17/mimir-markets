// Exit rules for one open position, in priority order: stop-loss, take-profit, trailing stop off
// the high, max hold time. Pure; the caller persists `high` when it moved.
import type { RiskParams, StrategyConfig } from "../types";
import { isPrice } from "./sol";

export type ExitInput = {
  position: { entryPrice: number; highPrice: number; openedAt: Date | number };
  /** Current SOL per whole token; NaN/null/≤0 = unknown. */
  price: number | null | undefined;
  risk: Pick<RiskParams, "stopLossPct" | "takeProfitPct">;
  config: Pick<StrategyConfig, "trailingStopPct" | "maxHoldMinutes">;
  now: number;
};

export type ExitDecision = {
  action: "hold" | "sell";
  /** Share of the position to sell, 0..1 (0 on hold). */
  fraction: number;
  reason: string;
  kind: "stop_loss" | "take_profit" | "trailing_stop" | "max_hold" | "hold" | "no_price" | "killed";
  /** Highest price seen so far (entry price if nothing better is known). */
  high: number;
  /** PnL vs entry in percent, null when unknown. */
  pnlPct: number | null;
};

const enabled = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 10) / 10}%`;

export function exitDecision({ position, price, risk, config, now }: ExitInput): ExitDecision {
  const entry = position.entryPrice;
  const prevHigh = isPrice(position.highPrice) ? position.highPrice : isPrice(entry) ? entry : NaN;
  const opened = position.openedAt instanceof Date ? position.openedAt.getTime() : position.openedAt;
  const heldMin = (now - opened) / 60_000;
  const timeUp = enabled(config.maxHoldMinutes) && Number.isFinite(heldMin) && heldMin >= config.maxHoldMinutes;
  const sell = (kind: ExitDecision["kind"], reason: string, high: number, pnlPct: number | null): ExitDecision =>
    ({ action: "sell", fraction: 1, reason, kind, high, pnlPct });

  if (!isPrice(price) || !isPrice(entry)) {
    // Without a price only the clock can decide; never invent a PnL.
    if (timeUp) return sell("max_hold", `max hold ${config.maxHoldMinutes}m reached (no price)`, prevHigh, null);
    return { action: "hold", fraction: 0, reason: "no price", kind: "no_price", high: prevHigh, pnlPct: null };
  }

  const high = isPrice(prevHigh) ? Math.max(prevHigh, price) : price;
  const pnlPct = (price / entry - 1) * 100;

  if (enabled(risk.stopLossPct) && pnlPct <= -risk.stopLossPct) return sell("stop_loss", `SL -${risk.stopLossPct}% hit (${pct(pnlPct)})`, high, pnlPct);
  if (enabled(risk.takeProfitPct) && pnlPct >= risk.takeProfitPct) return sell("take_profit", `TP +${risk.takeProfitPct}% hit (${pct(pnlPct)})`, high, pnlPct);
  if (enabled(config.trailingStopPct)) {
    const drawdown = (1 - price / high) * 100;
    if (drawdown >= config.trailingStopPct) {
      return sell("trailing_stop", `trailing stop ${config.trailingStopPct}% off high hit (${pct(-drawdown)} from high, ${pct(pnlPct)} total)`, high, pnlPct);
    }
  }
  if (timeUp) return sell("max_hold", `max hold ${config.maxHoldMinutes}m reached (${pct(pnlPct)})`, high, pnlPct);
  return { action: "hold", fraction: 0, reason: `holding at ${pct(pnlPct)}`, kind: "hold", high, pnlPct };
}
