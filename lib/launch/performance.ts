/** Confirmed execution evidence. Native trading and Arc stakes deliberately keep separate units. */
export type PerformanceTrade = { side: string; status: string; lamports: string; pnlLamports?: string | null; at: number; sig: string };
export type PerformancePosition = { mint: string; symbol: string; costLamports: string };
export function tradingPerformance(trades: readonly PerformanceTrade[], positions: readonly PerformancePosition[], now: number) {
  const confirmed = trades.filter((t) => t.status === "confirmed" && t.at <= now).sort((a, b) => a.at - b.at);
  const periods = [7, 30, 90].map((days) => {
    const rows = confirmed.filter((t) => t.at >= now - days * 86_400_000);
    let pnl = 0n, closedCost = 0n, peak = 0n, drawdown = 0n, wins = 0, losses = 0, exits = 0;
    for (const t of rows) {
      if (t.side !== "sell" || t.pnlLamports == null) continue;
      const result = BigInt(t.pnlLamports);
      const cost = BigInt(t.lamports) - result;
      if (cost < 0n) continue;
      closedCost += cost; pnl += result; exits++;
      if (result > 0n) wins++; else if (result < 0n) losses++;
      if (pnl > peak) peak = pnl;
      if (peak - pnl > drawdown) drawdown = peak - pnl;
    }
    return { days, trades: rows.length, exits, wins, losses, pnl: pnl.toString(), closedCost: closedCost.toString(),
      costReturnPct: closedCost > 0n ? Number(pnl * 1_000_000n / closedCost) / 10_000 : null,
      realizedDrawdown: drawdown.toString() };
  });
  return { periods, openCost: positions.reduce((s, p) => s + BigInt(p.costLamports), 0n).toString(), openPositions: positions.length,
    evidence: confirmed.slice(-12).reverse().map(({ sig, at, side }) => ({ sig, at, side })) };
}
