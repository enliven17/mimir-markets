// Lamport/percent helpers. Money is bigint; percentages are converted to basis points once so no
// float ever touches an amount.

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** pct (e.g. 12.5) → basis points (1250n), clamped to 0..10000; NaN → 0. */
export function pctToBps(pct: number): bigint {
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0) return 0n;
  return BigInt(Math.min(10_000, Math.floor(pct * 100)));
}

export const mulBps = (amount: bigint, bps: bigint): bigint => (amount * bps) / 10_000n;

/** "0.83" style SOL string, up to 3 decimals, trailing zeros trimmed. */
export function fmtSol(lamports: bigint): string {
  const neg = lamports < 0n;
  const abs = neg ? -lamports : lamports;
  const milli = (abs + 500_000n) / 1_000_000n; // round to 0.001 SOL
  const whole = milli / 1000n;
  const frac = (milli % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** SOL per whole token implied by a fill; null when it can't be computed. */
export function fillPrice(lamports: bigint, tokens: bigint, decimals: number): number | null {
  if (lamports <= 0n || tokens <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const p = (Number(lamports) / 1e9) / (Number(tokens) / 10 ** decimals);
  return Number.isFinite(p) && p > 0 ? p : null;
}

export const isPrice = (p: unknown): p is number => typeof p === "number" && Number.isFinite(p) && p > 0;

export const shortMint = (mint: string): string => (mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint);

/** "$PNUT", or a short mint when the symbol is unknown. */
export const label = (symbol: string | undefined, mint: string): string =>
  symbol && symbol.trim() ? `$${symbol.trim().slice(0, 16)}` : shortMint(mint);
