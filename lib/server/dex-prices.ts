/**
 * Live USD prices for Solana mainnet SPL / Token-2022 tokens from keyless DEX
 * aggregators: DexScreener (pair data) and Jupiter (its price API).
 *
 * Used for $ANSEM and the Mimir token, which no oracle network or CEX feed
 * covers. The two services index overlapping pools, so they are two readers
 * of the same market rather than two markets; they still catch a stale or
 * broken reading on either side, which is what the settlement cross-check
 * needs. Both only serve the live price, so they join settlement only when the
 * oracle runs within minutes of a claim's deadline.
 *
 * Parsers are pure and exported for tests; fetchers never throw.
 */
import type { PriceReading } from "../price-consensus";

const TIMEOUT_MS = 8_000;
/**
 * Pools thinner than this are ignored. A thin pool's price is whatever the
 * last swap made it, and a claim pays out on it: the floor is set so moving
 * the price costs more than a pot is likely to hold (DEX_MIN_LIQUIDITY_USD).
 */
export const MIN_LIQUIDITY_USD = (() => {
  const v = Number(process.env.DEX_MIN_LIQUIDITY_USD ?? "250000");
  return Number.isFinite(v) && v > 0 ? v : 250_000;
})();

interface DexPair {
  chainId?: string;
  baseToken?: { address?: string };
  priceUsd?: string | number;
  liquidity?: { usd?: number };
}

/** The price of `mint` from its deepest Solana pair where it is the base token. */
export function parseDexScreenerPrice(body: unknown, mint: string): number | null {
  const pairs: DexPair[] = Array.isArray(body)
    ? (body as DexPair[])
    : Array.isArray((body as { pairs?: unknown })?.pairs)
      ? ((body as { pairs: DexPair[] }).pairs)
      : [];
  let best: { price: number; liquidity: number } | null = null;
  for (const p of pairs) {
    if (p?.chainId !== "solana" || p.baseToken?.address !== mint) continue;
    const price = Number(p.priceUsd);
    const liquidity = Number(p.liquidity?.usd ?? 0);
    if (!Number.isFinite(price) || price <= 0 || !(liquidity >= MIN_LIQUIDITY_USD)) continue;
    if (!best || liquidity > best.liquidity) best = { price, liquidity };
  }
  return best?.price ?? null;
}

/** Jupiter price v3: `{ [mint]: { usdPrice, liquidity } }`. No liquidity figure, no price. */
export function parseJupiterPrice(body: unknown, mint: string): number | null {
  const entry = (body as Record<string, { usdPrice?: number; liquidity?: number } | undefined> | null)?.[mint];
  const price = Number(entry?.usdPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!(Number(entry?.liquidity) >= MIN_LIQUIDITY_USD)) return null;
  return price;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchDexScreenerPrice(mint: string): Promise<PriceReading | null> {
  try {
    const price = parseDexScreenerPrice(await getJson(`https://api.dexscreener.com/tokens/v1/solana/${mint}`), mint);
    return price ? { source: "dexscreener", priceUsd: price, at: Date.now() } : null;
  } catch {
    return null;
  }
}

export async function fetchJupiterPrice(mint: string): Promise<PriceReading | null> {
  try {
    const price = parseJupiterPrice(await getJson(`https://lite-api.jup.ag/price/v3?ids=${mint}`), mint);
    return price ? { source: "jupiter", priceUsd: price, at: Date.now() } : null;
  } catch {
    return null;
  }
}

/** Both readings, whatever came back. */
export async function fetchDexReadings(mint: string): Promise<PriceReading[]> {
  const results = await Promise.all([fetchDexScreenerPrice(mint), fetchJupiterPrice(mint)]);
  return results.filter((r): r is PriceReading => r !== null);
}

export interface DexStats {
  priceUsd: number;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
  pairUrl: string | null;
}

/**
 * Display stats for `mint` from its deepest Solana pair. For showing only
 * (the bot's /price): no liquidity floor, so never use it to settle.
 */
export function parseDexStats(body: unknown, mint: string): DexStats | null {
  const pairs = (Array.isArray(body) ? body : []) as Array<
    DexPair & { marketCap?: number; fdv?: number; volume?: { h24?: number }; priceChange?: { h24?: number }; url?: string }
  >;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const best = pairs
    .filter((p) => p?.chainId === "solana" && p.baseToken?.address === mint && Number(p.priceUsd) > 0)
    .sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))[0];
  if (!best) return null;
  return {
    priceUsd: Number(best.priceUsd),
    marketCapUsd: num(best.marketCap ?? best.fdv),
    liquidityUsd: num(best.liquidity?.usd),
    volume24hUsd: num(best.volume?.h24),
    change24hPct: num(best.priceChange?.h24),
    pairUrl: typeof best.url === "string" ? best.url : null,
  };
}

export async function fetchDexStats(mint: string): Promise<DexStats | null> {
  try {
    return parseDexStats(await getJson(`https://api.dexscreener.com/tokens/v1/solana/${mint}`), mint);
  } catch {
    return null;
  }
}
