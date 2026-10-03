/** Mimir Terminal: plain-text formatting for monospace output. Pure. */

/** USDC base units (6 dp) as a short number: 3000000 → "3", 2500000 → "2.5". */
export function usdc(units: string | number | bigint): string {
  const n = Number(units) / 1e6;
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 2 });
}

/** "2d 4h", "3h 12m", "45m", "closed". */
export function timeLeft(deadlineSec: number, nowMs = Date.now()): string {
  const s = Math.floor(deadlineSec - nowMs / 1000);
  if (s <= 0) return "closed";
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

/** The creator's share of the pool as a bar of `width` cells: "████░░░░ 50%". */
export function oddsBar(creatorUnits: string | number, challengerUnits: string | number, width = 12): string {
  const a = Number(creatorUnits), b = Number(challengerUnits), total = a + b;
  const share = total > 0 ? a / total : 0.5;
  const filled = Math.round(share * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${Math.round(share * 100)}%`;
}

/** "8r2L…jd4V". */
export const short = (s: string, head = 4, tail = 4) => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

/** "$1.2M", "$18.1K", "$0.00001913". */
export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
}

/** Right-pad or cut to exactly `n` characters (for monospace columns). */
export function col(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
}
