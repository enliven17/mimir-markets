import { withResolverFragment, resolverSpecFor } from "./resolver-spec";
export const MARKET_SERIES = [
  { id: "sol-daily", symbol: "SOL", name: "SOL daily checkpoint", source: "https://www.coingecko.com/en/coins/solana" },
  { id: "btc-daily", symbol: "BTC", name: "BTC daily checkpoint", source: "https://www.coingecko.com/en/coins/bitcoin" },
] as const;
export function nextSeriesDeadline(now: number) {
  const d = new Date(now); const noon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
  return Math.floor((noon > now + 600_000 ? noon : noon + 86_400_000) / 1000);
}
export function seriesDraft(id: string, threshold: number, now: number) {
  const s = MARKET_SERIES.find((s) => s.id === id);
  if (!s || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1_000_000_000) return null;
  const deadline = nextSeriesDeadline(now), date = new Date(deadline * 1000).toISOString().slice(0, 10);
  return { question: `${s.symbol} daily ${date}: will ${s.symbol} be above $${threshold} at 12:00 UTC?`, labelA: "Yes", labelB: "No", deadline, category: "crypto",
    resolutionUrl: withResolverFragment(s.source, { kind: "price", symbol: s.symbol, op: ">", threshold }) };
}
/** A recognizable series needs its question, side labels, deadline and machine-readable rule to agree. */
export function seriesForMarket(m: { question: string; resolutionUrl: string; deadline: number; labelA: string; labelB: string; category: string }): string | null {
  const spec = resolverSpecFor({ resolutionUrl: m.resolutionUrl });
  if (!spec || spec.kind !== "price" || spec.op !== ">" || m.category !== "crypto" || m.labelA !== "Yes" || m.labelB !== "No") return null;
  const s = MARKET_SERIES.find((s) => s.symbol === spec.symbol); if (!s) return null;
  if (!Number.isFinite(m.deadline)) return null;
  const d = new Date(m.deadline * 1000);
  if (d.getUTCHours() !== 12 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0) return null;
  const question = `${s.symbol} daily ${d.toISOString().slice(0, 10)}: will ${s.symbol} be above $${spec.threshold} at 12:00 UTC?`;
  return m.question === question && m.resolutionUrl === withResolverFragment(s.source, spec) ? s.id : null;
}
