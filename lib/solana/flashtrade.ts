/**
 * Flash Trade integration — Solana's asset-backed perpetuals DEX.
 *
 * Free public REST API, no key needed, 10 req/s limit.
 * Docs: https://docs.flash.trade/.../flash-trade-api
 *
 * Two roles in Mimir:
 *   A) Resolution source — claims resolve against Flash Trade oracle prices
 *      (the resolutionUrl IS a flashapi.trade endpoint; the oracle agent
 *      fetches it like any other evidence URL).
 *   B) Auto-hedge — when an agent stakes on a price-directional claim, it
 *      offsets the exposure with a perp position built by the Flash Trade
 *      transaction-builder.
 */

export const FLASH_API_BASE = "https://flashapi.trade";

export interface FlashPrice {
  price: number;
  exponent: number;
  confidence: number;
  priceUi: number;
  timestampUs: number;
  marketSession: string;
}

export interface OpenPositionRequest {
  inputTokenSymbol: string; // collateral, e.g. "USDC"
  outputTokenSymbol: string; // market, e.g. "SOL" | "BTC" | "ETH"
  inputAmountUi: string; // collateral amount, e.g. "10.0"
  leverage: number; // e.g. 2.0
  tradeType: "LONG" | "SHORT";
  owner: string; // wallet pubkey (base58)
}

async function flashFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${FLASH_API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FlashTrade ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Live oracle price for one symbol (e.g. "BTC", "SOL", "ETH", "TSLA"). */
export async function getFlashPrice(symbol: string): Promise<FlashPrice> {
  return flashFetch(`/prices/${encodeURIComponent(symbol.toUpperCase())}`);
}

/** All Flash Trade oracle prices keyed by symbol. */
export async function getAllFlashPrices(): Promise<Record<string, FlashPrice>> {
  return flashFetch("/prices");
}

/** Open positions for a wallet, enriched with PnL / leverage. */
export async function getFlashPositions(owner: string): Promise<any> {
  return flashFetch(`/positions/owner/${owner}`);
}

/**
 * Build a ready-to-sign open-position transaction.
 * Returns whatever the API gives us — typically a base64-serialized tx.
 */
export async function buildOpenPositionTx(req: OpenPositionRequest): Promise<any> {
  return flashFetch("/transaction-builder/open-position", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function buildClosePositionTx(req: {
  positionKey: string;
  inputUsdUi: string;
  withdrawTokenSymbol: string;
}): Promise<any> {
  return flashFetch("/transaction-builder/close-position", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ── Mimir glue ─────────────────────────────────────────────────────────────

/** Symbols Flash Trade prices that Mimir lets the market-creator use. */
export const FLASH_CLAIM_SYMBOLS = ["BTC", "ETH", "SOL"] as const;

/** Resolution URL for a price claim — the oracle fetches this as evidence. */
export function flashResolutionUrl(symbol: string): string {
  return `${FLASH_API_BASE}/prices/${symbol.toUpperCase()}`;
}

export function isFlashResolutionUrl(url: string): boolean {
  return url.startsWith(`${FLASH_API_BASE}/prices`);
}

export interface HedgePlan {
  symbol: string;
  tradeType: "LONG" | "SHORT";
  collateralUsd: number;
  leverage: number;
  rationale: string;
}

/**
 * Derive the hedge for a directional stake on a price claim.
 *
 * If the agent staked on "price will be ABOVE X" it is long-biased, so the
 * hedge is a SHORT perp of roughly the same notional (and vice versa).
 * Returns null when the claim isn't price-directional.
 */
export function planHedgeForStake(opts: {
  question: string;
  sidePosition: string; // the position text of the side the agent staked on
  stakeUsd: number;
  hedgeRatio?: number; // fraction of stake to hedge, default 1.0
  leverage?: number; // default 2x
}): HedgePlan | null {
  const text = `${opts.question} ${opts.sidePosition}`.toUpperCase();
  const symbol = FLASH_CLAIM_SYMBOLS.find((s) =>
    new RegExp(`\\b${s}\\b|BITCOIN|ETHEREUM|SOLANA`).test(text)
      ? text.includes(s) ||
        (s === "BTC" && text.includes("BITCOIN")) ||
        (s === "ETH" && text.includes("ETHEREUM")) ||
        (s === "SOL" && text.includes("SOLANA"))
      : false
  );
  if (!symbol) return null;

  const bullish = /ABOVE|OVER|EXCEED|HIGHER|RISE|>\s*\$?\d/.test(
    opts.sidePosition.toUpperCase()
  );
  const bearish = /BELOW|UNDER|LOWER|FALL|DROP|<\s*\$?\d/.test(
    opts.sidePosition.toUpperCase()
  );
  if (!bullish && !bearish) return null;

  const leverage = opts.leverage ?? 2;
  const collateralUsd =
    Math.round(((opts.stakeUsd * (opts.hedgeRatio ?? 1)) / leverage) * 100) / 100;

  return {
    symbol,
    // bet exposure is long → hedge short, and vice versa
    tradeType: bullish ? "SHORT" : "LONG",
    collateralUsd,
    leverage,
    rationale: `Stake is ${bullish ? "long" : "short"}-biased on ${symbol}; offsetting with a ${
      bullish ? "SHORT" : "LONG"
    } ${leverage}x perp (~${(collateralUsd * leverage).toFixed(2)} USD notional) on Flash Trade.`,
  };
}
