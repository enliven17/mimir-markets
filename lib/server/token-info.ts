/**
 * A Solana mainnet token by its mint, for the terminal's `token` command:
 * one Jupiter token-search call (price, mcap, liquidity, holders, mint/freeze
 * authority, organic score), DexScreener as the fallback. Display only:
 * never used to settle anything. Cached per mint for a minute.
 */
import { fetchDexStats } from "./dex-prices";
import { cachedFor } from "./ttl-cache";

export interface TokenInfo {
  mint: string;
  name: string | null;
  symbol: string | null;
  /** Token decimals (Jupiter); null from the DexScreener fallback. */
  decimals: number | null;
  priceUsd: number | null;
  change24hPct: number | null;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  /** Jupiter's verdict on the token, when it has one. */
  verified: boolean | null;
  organicScore: string | null;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  topHoldersPct: number | null;
  source: "jupiter" | "dexscreener";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Jupiter `tokens/v2/search` → TokenInfo for exactly `mint`, or null. Pure; exported for tests. */
export function parseJupiterToken(body: unknown, mint: string): TokenInfo | null {
  const t = (Array.isArray(body) ? body : []).find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === mint) as
    | Record<string, any>
    | undefined;
  if (!t) return null;
  const s24 = t.stats24h ?? {};
  const vol = num(s24.buyVolume) !== null && num(s24.sellVolume) !== null ? s24.buyVolume + s24.sellVolume : null;
  return {
    mint,
    name: typeof t.name === "string" ? t.name.slice(0, 64) : null,
    symbol: typeof t.symbol === "string" ? t.symbol.slice(0, 16) : null,
    decimals: num(t.decimals),
    priceUsd: num(t.usdPrice),
    change24hPct: num(s24.priceChange),
    mcapUsd: num(t.mcap) ?? num(t.fdv),
    liquidityUsd: num(t.liquidity),
    volume24hUsd: vol,
    holders: num(t.holderCount),
    // Jupiter marks verified tokens with a tag; isVerified when present.
    verified: bool(t.isVerified) ?? (Array.isArray(t.tags) ? t.tags.includes("verified") : null),
    organicScore: typeof t.organicScoreLabel === "string" ? t.organicScoreLabel : null,
    mintAuthorityDisabled: bool(t.audit?.mintAuthorityDisabled),
    freezeAuthorityDisabled: bool(t.audit?.freezeAuthorityDisabled),
    topHoldersPct: num(t.audit?.topHoldersPercentage),
    source: "jupiter",
  };
}

async function readToken(mint: string): Promise<TokenInfo | null> {
  try {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const info = parseJupiterToken(await res.json(), mint);
      if (info) return info;
    }
  } catch {
    // fall through to DexScreener
  }
  const dex = await fetchDexStats(mint);
  if (!dex) return null;
  return {
    mint, name: null, symbol: null, decimals: null, priceUsd: dex.priceUsd, change24hPct: dex.change24hPct, mcapUsd: dex.marketCapUsd,
    liquidityUsd: dex.liquidityUsd, volume24hUsd: dex.volume24hUsd, holders: null, verified: null, organicScore: null,
    mintAuthorityDisabled: null, freezeAuthorityDisabled: null, topHoldersPct: null, source: "dexscreener",
  };
}

export const tokenInfo = cachedFor(readToken, 60_000, 500);
