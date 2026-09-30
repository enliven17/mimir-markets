/**
 * Crypto price claims around the live Flash Trade spot (BTC/ETH/SOL), ±0.3%.
 *
 * The threshold is derived from the live price, never drafted by a model, so
 * the source's stale-moonshot guard (CRYPTO_MIN/MAX_THRESHOLD_RATIO) is met by
 * construction; `thresholdProblem` still checks it, in case the skew is ever
 * made configurable. A structured resolver in the URL fragment lets the oracle
 * settle these from deadline prices across independent feeds, no model
 * involved.
 */
import { FLASH_CLAIM_SYMBOLS, flashResolutionUrl, getFlashPrice } from "../../lib/solana/flashtrade";
import { priceSpecFromQuestion, withResolverFragment } from "../../lib/resolver-spec";
import { toDeadline, type DraftClaim } from "./draft";

const SYMBOL_NAMES: Record<string, string> = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana" };
const SKEW = 0.003;

export const CRYPTO_MIN_THRESHOLD_RATIO = Number(process.env.CRYPTO_MIN_THRESHOLD_RATIO ?? "0.65");
export const CRYPTO_MAX_THRESHOLD_RATIO = Number(process.env.CRYPTO_MAX_THRESHOLD_RATIO ?? "1.35");

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Why a threshold is unrealistic against the live price, or null. */
export function thresholdProblem(threshold: number, spot: number): string | null {
  if (!Number.isFinite(spot) || spot <= 0) return "no live price";
  const low = spot * CRYPTO_MIN_THRESHOLD_RATIO;
  const high = spot * CRYPTO_MAX_THRESHOLD_RATIO;
  return threshold >= low && threshold <= high ? null : `$${fmt(threshold)} outside $${fmt(low)}-$${fmt(high)}`;
}

export function skewedThreshold(spot: number, direction: "above" | "below"): number {
  return round2(spot * (direction === "above" ? 1 + SKEW : 1 - SKEW));
}

export function cryptoDraft(symbol: string, threshold: number, direction: "above" | "below", deadlineMs: number): DraftClaim {
  const name = SYMBOL_NAMES[symbol] ?? symbol;
  const question = `Will ${name} (${symbol}) trade ${direction} $${fmt(threshold)} at the deadline, per the Flash Trade oracle price?`;
  const spec = priceSpecFromQuestion(question, symbol, threshold);
  const base = flashResolutionUrl(symbol);
  return {
    question,
    creatorPosition: `Yes: ${symbol} will be ${direction} $${fmt(threshold)}`,
    counterPosition: `No: ${symbol} will not be ${direction} $${fmt(threshold)}`,
    category: "crypto",
    resolutionUrl: spec ? withResolverFragment(base, spec) : base,
    settlementRule:
      `Resolve from the ${symbol} price on the linked Flash Trade oracle feed at the deadline ` +
      `(${new Date(deadlineMs).toISOString()} UTC), cross-checked against independent price sources.`,
    deadline: toDeadline(deadlineMs),
    source: "flash",
    label: `${symbol} ${direction} $${fmt(threshold)}`,
  };
}

export async function draftCryptoClaims(count: number, horizonMin: number, now = Date.now()): Promise<DraftClaim[]> {
  const out: DraftClaim[] = [];
  for (const symbol of FLASH_CLAIM_SYMBOLS) {
    if (out.length >= count) break;
    try {
      const px = await getFlashPrice(symbol);
      const direction = Math.random() < 0.5 ? "above" : "below";
      const threshold = skewedThreshold(px.priceUi, direction);
      const problem = thresholdProblem(threshold, px.priceUi);
      if (problem) {
        console.warn(`[draft] ${symbol} dropped: ${problem}`);
        continue;
      }
      out.push(cryptoDraft(symbol, threshold, direction, now + horizonMin * 60_000));
    } catch (err: any) {
      console.warn(`[draft] ${symbol} price fetch failed:`, err?.message ?? err);
    }
  }
  return out;
}
