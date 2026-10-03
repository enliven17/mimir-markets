/**
 * $ANSEM price claims around the live mainnet DEX price.
 *
 * $ANSEM has no oracle network or CEX feed, so the spot comes from
 * DexScreener + Jupiter (lib/server/dex-prices.ts), the same readers the
 * oracle's deterministic resolver uses at the deadline (plus CoinGecko).
 * Both only serve the live price, so the horizon stays short
 * (CREATOR_HORIZON_MIN) and the oracle settles within minutes of it.
 *
 * The threshold is derived from the live price by rule, never drafted by a
 * model; the draft is only made when both readers answer and agree within the
 * consensus spread, so a stale or broken pool never seeds a market.
 */
import { MAX_SOURCE_SPREAD, type PriceReading } from "../../lib/price-consensus";
import { priceSpecFromQuestion, withResolverFragment } from "../../lib/resolver-spec";
import { fetchDexReadings } from "../../lib/server/dex-prices";
import { ansemMint, dexSourceUrl } from "../../lib/token-config";
import { toDeadline, type DraftClaim } from "./draft";

/**
 * CREATOR_ANSEM_PER_RUN when unset: 0 on mainnet. $ANSEM is DEX-priced, so
 * the oracle no longer settles it from the structured resolver (one swap near
 * the deadline moves a thin pool, audit P0-4) and its claims would fall to
 * the LLM over a page anyone can move. Opt back in only with a TWAP feed.
 */
export function defaultAnsemPerRun(mainnet: boolean): string {
  return mainnet ? "0" : "1";
}

/** Memecoin moves are larger than majors': ±2% around spot by default. */
export const ANSEM_SKEW = Number(process.env.CREATOR_ANSEM_SKEW ?? "0.02");

/** Four significant digits: $ANSEM trades well below a dollar. */
export function formatTokenPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(Number(n.toPrecision(4)));
}

/** Mid of the readings when at least two agree within the consensus spread, else null. */
export function agreedSpot(readings: PriceReading[]): number | null {
  const prices = readings.map((r) => r.priceUsd).filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length < 2) return null;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  if ((hi - lo) / lo > MAX_SOURCE_SPREAD) return null;
  return (lo + hi) / 2;
}

export function ansemThreshold(spot: number, direction: "above" | "below", skew = ANSEM_SKEW): number {
  return Number((spot * (direction === "above" ? 1 + skew : 1 - skew)).toPrecision(4));
}

export function ansemDraft(threshold: number, direction: "above" | "below", deadlineMs: number, mint = ansemMint()): DraftClaim {
  const px = formatTokenPrice(threshold);
  const question = `Will $ANSEM trade ${direction} $${px} at the deadline, per DexScreener and Jupiter?`;
  const spec = priceSpecFromQuestion(question, "ANSEM", Number(px));
  const base = dexSourceUrl(mint);
  return {
    question,
    creatorPosition: `Yes: $ANSEM will be ${direction} $${px}`,
    counterPosition: `No: $ANSEM will not be ${direction} $${px}`,
    category: "crypto",
    resolutionUrl: spec ? withResolverFragment(base, spec) : base,
    settlementRule:
      `Resolve from the $ANSEM USD price on Solana mainnet at the deadline ` +
      `(${new Date(deadlineMs).toISOString()} UTC): DexScreener's deepest pool and Jupiter's price API, ` +
      `cross-checked with CoinGecko; sources that disagree across the threshold refund both sides.`,
    deadline: toDeadline(deadlineMs),
    source: "ansem",
    label: `ANSEM ${direction} $${px}`,
  };
}

export async function draftAnsemClaims(
  count: number,
  horizonMin: number,
  now = Date.now(),
  readPrices: (mint: string) => Promise<PriceReading[]> = fetchDexReadings,
): Promise<DraftClaim[]> {
  if (count <= 0) return [];
  const readings = await readPrices(ansemMint()).catch(() => []);
  const spot = agreedSpot(readings);
  if (spot === null) {
    console.warn(`[draft] ANSEM dropped: ${readings.length} DEX reading(s), no agreeing pair`);
    return [];
  }
  const direction = Math.random() < 0.5 ? "above" : "below";
  // Dedupe keys on the source URL, so one ANSEM market at a time is the most a run adds.
  return [ansemDraft(ansemThreshold(spot, direction), direction, now + horizonMin * 60_000)].slice(0, count);
}
