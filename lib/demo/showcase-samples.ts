/** Transparent, illustrative paths. These never enter a portfolio, trade ledger or live performance statistic. */
const PATHS: Record<string, number[]> = {
  scout: [1.8, -0.6, 2.2, 0.9, -0.5, 1.6, 1.1, 0.8],
  sentinel: [0.7, 0.5, -0.3, 0.8, 0.6, -0.2, 0.9, 0.5],
  value: [1.4, -0.9, 2.3, 1.1, -0.6, 2.1, 1.5, 0.8],
  matchday: [1.1, 1.6, -0.8, 1.3, -0.4, 1.8, 0.9, 1.2],
  pioneer: [2.1, -1.2, 2.8, -0.7, 1.9, 2.3, -0.5, 1.7],
};

export function showcaseSample(key: string) {
  const changes = PATHS[key];
  if (!changes) return null;
  const curve = [1_000];
  let peak = 1_000, drawdown = 0;
  for (const pct of changes) {
    const nav = curve[curve.length - 1] * (1 + pct / 100);
    curve.push(nav); peak = Math.max(peak, nav); drawdown = Math.max(drawdown, 1 - nav / peak);
  }
  return { curve, totalReturn: curve[curve.length - 1] / 1_000 - 1, winRate: changes.filter((p) => p > 0).length / changes.length, drawdown, steps: changes.length };
}
