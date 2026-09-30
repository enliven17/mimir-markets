/**
 * Canonical USDC display formatting. All UI money rendering goes through here
 * so amounts read the same on every page.
 *
 * On Solana, USDC is an SPL token with 6 decimals and APIs carry base units as
 * strings (or bigint), so the `*Units` helpers take those directly.
 */

const USDC_DECIMALS = 6;
const UNITS_PER_USDC = 10 ** USDC_DECIMALS;

function trimFixed(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

/** Base units (bigint, numeric string or number) to a USDC number. NaN-safe: junk is 0. */
export function unitsToUsdc(units: bigint | string | number | null | undefined): number {
  if (units === null || units === undefined || units === "") return 0;
  const n = typeof units === "bigint" ? Number(units) : Number(units);
  return Number.isFinite(n) ? n / UNITS_PER_USDC : 0;
}

/** Full display string with unit: "1,234.56 USDC", "<0.000001 USDC", "0 USDC". */
export function formatUsdc(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0 USDC";
  const abs = Math.abs(value);
  if (abs < 0.000001) return "<0.000001 USDC";
  if (abs < 1) return `${trimFixed(value, 6)} USDC`;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDC`;
}

/** Bare number ("1,234.56", "12") for layouts that render the unit separately. */
export function formatUsdcBare(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/** `formatUsdc` for base units. */
export function formatUsdcUnits(units: bigint | string | number | null | undefined): string {
  return formatUsdc(unitsToUsdc(units));
}

/** `formatUsdcBare` for base units: "2,500000" base units → "2.5". */
export function formatUsdcUnitsBare(units: bigint | string | number | null | undefined): string {
  return formatUsdcBare(unitsToUsdc(units));
}

/** Keep an amount and its unit on one line ("7.00 USDC" never wraps before "USDC"). */
export function nowrap(amount: string): string {
  return amount.replace(/ /g, " ");
}
