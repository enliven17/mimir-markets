export type CopyRiskPolicy = { maxTokenLamports: string; maxTotalLamports: string; dailyLossLamports: string; maxDrawdownLamports: string; maxPriceDriftBps: number; maxLiquidityBps: number };
export const DEFAULT_COPY_RISK: CopyRiskPolicy = { maxTokenLamports: "200000000", maxTotalLamports: "1000000000", dailyLossLamports: "100000000", maxDrawdownLamports: "200000000", maxPriceDriftBps: 300, maxLiquidityBps: 10 };
/** Limits are shared across all of a follower's Solana copy subscriptions. Exposure uses recorded cost. */
export function copyRiskProblem(p: CopyRiskPolicy, s: { tokenCost: bigint; totalCost: bigint; dailyPnl: bigint; pnl: bigint; peak: bigint }, amount: bigint): string | null {
  if (amount <= 0n) return "Copy size must be positive.";
  if (BigInt(p.maxTokenLamports) > 0n && s.tokenCost + amount > BigInt(p.maxTokenLamports)) return "Shared token exposure limit reached.";
  if (BigInt(p.maxTotalLamports) > 0n && s.totalCost + amount > BigInt(p.maxTotalLamports)) return "Shared open cost limit reached.";
  if (BigInt(p.dailyLossLamports) > 0n && s.dailyPnl <= -BigInt(p.dailyLossLamports)) return "Daily realized copy loss limit reached.";
  if (BigInt(p.maxDrawdownLamports) > 0n && s.peak - s.pnl >= BigInt(p.maxDrawdownLamports)) return "Realized copy PnL drawdown limit reached.";
  return null;
}
export function copyQuoteProblem(p: CopyRiskPolicy, q: { referencePrice?: number; signalAt?: number; price: number; liquiditySol: number; now: number }, amount: bigint): string | null {
  if (!q.signalAt || q.signalAt > q.now + 5_000 || q.now - q.signalAt > 120_000) return "Copy signal expired or has no timestamp.";
  if (!q.referencePrice || !Number.isFinite(q.referencePrice) || !Number.isFinite(q.price) || q.price <= 0) return "Copy price unavailable.";
  if (Math.abs(q.price / q.referencePrice - 1) * 10_000 > p.maxPriceDriftBps) return "Price moved beyond your copy limit.";
  if (!Number.isFinite(q.liquiditySol) || q.liquiditySol <= 0) return "Copy liquidity unavailable.";
  if (Number(amount) / 1e9 > q.liquiditySol * p.maxLiquidityBps / 10_000) return "Copy size exceeds your share-of-liquidity limit.";
  return null;
}
