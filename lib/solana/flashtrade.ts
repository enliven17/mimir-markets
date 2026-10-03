/**
 * Flash Trade integration: Solana's asset-backed perpetuals DEX.
 *
 * Free public REST API, no key needed, 10 req/s limit.
 * Docs: https://docs.flash.trade/.../flash-trade-api
 *
 * Two roles in Mimir:
 *   A) Resolution source: claims resolve against Flash Trade oracle prices
 *      (the resolutionUrl IS a flashapi.trade endpoint; the oracle agent
 *      fetches it like any other evidence URL).
 *   B) Auto-hedge: when an agent stakes on a price-directional claim, it
 *      offsets the exposure with a perp position built by the Flash Trade
 *      transaction-builder. The built tx is checked (verifyHedgeTx) before
 *      it is signed: a compromised API must not get a blind signature.
 */
import type { PublicKey, VersionedTransaction } from "@solana/web3.js";

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
 * Returns whatever the API gives us, typically a base64-serialized tx.
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

/** Resolution URL for a price claim; the oracle fetches this as evidence. */
export function flashResolutionUrl(symbol: string): string {
  return `${FLASH_API_BASE}/prices/${symbol.toUpperCase()}`;
}

export function isFlashResolutionUrl(url: string): boolean {
  return url.startsWith(`${FLASH_API_BASE}/prices`);
}


// ── Hedging (oracle auto-challenge, HEDGE_MODE) ────────────────────────────

/** Flash Trade's mainnet perpetuals program and its composability (swap-and-open) program, per flash-sdk PoolConfig. */
export const FLASH_PERP_PROGRAM_IDS = [
  "FLASH6Lo6h3iasJKWDs2F8TkW2UKf3s15C8PMGuVfgBn",
  "FSWAPViR8ny5K96hezav8jynVubP2dJ2L7SbKzds2hwm",
] as const;

/**
 * Programs a Flash-built hedge tx may call. Deliberately no System or SPL
 * Token program: either would let a compromised builder add a plain transfer
 * out of the signing wallet. A tx that needs them is refused, not signed.
 */
export const HEDGE_PROGRAM_ALLOWLIST: ReadonlySet<string> = new Set([
  ...FLASH_PERP_PROGRAM_IDS,
  "ComputeBudget111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // associated token account (create idempotent)
]);

const COMPUTE_BUDGET_ID = "ComputeBudget111111111111111111111111111111";
const ATA_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Highest priority fee (micro-lamports per CU) a hedge tx may set (HEDGE_MAX_PRIORITY_MICRO_LAMPORTS). */
export const HEDGE_MAX_PRIORITY_MICRO_LAMPORTS = (() => {
  const v = Number(process.env.HEDGE_MAX_PRIORITY_MICRO_LAMPORTS ?? "1000000");
  return Number.isFinite(v) && v >= 0 ? v : 1_000_000;
})();

export interface HedgePlan {
  symbol: string;
  tradeType: "LONG" | "SHORT";
  collateralUsd: number;
  leverage: number;
  rationale: string;
}

/**
 * The hedge for a stake, from the claim's resolver spec rather than its
 * wording ("No: BTC will not be above X" contains "above"). The staked side
 * wins when the spec's condition is met if it is the Yes side: then a ">"
 * spec is long exposure, hedged SHORT, and a "<" spec the reverse. Null when
 * the positions are not Yes/No, or Flash Trade does not list the symbol.
 */
export function planHedgeFromSpec(opts: {
  spec: { symbol: string; op: ">" | ">=" | "<" | "<=" | "==" | "!=" };
  /** True when the staked side wins if the spec's condition is met. */
  stakedSideWinsIfMet: boolean;
  stakeUsd: number;
  hedgeRatio?: number; // fraction of stake to hedge, default 1.0
  leverage?: number; // default 2x
}): HedgePlan | null {
  const symbol = opts.spec.symbol.toUpperCase();
  if (!(FLASH_CLAIM_SYMBOLS as readonly string[]).includes(symbol)) return null;
  const up = opts.spec.op === ">" || opts.spec.op === ">=";
  const down = opts.spec.op === "<" || opts.spec.op === "<=";
  if (!up && !down) return null;
  const bullish = up === opts.stakedSideWinsIfMet;

  const leverage = opts.leverage ?? 2;
  const collateralUsd = Math.round(((opts.stakeUsd * (opts.hedgeRatio ?? 1)) / leverage) * 100) / 100;
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

/**
 * Check a transaction Flash Trade's API built before our key signs it: the
 * fee payer must be `owner`, and every instruction must call an allowlisted
 * program. Program ids can never come from an address lookup table (the
 * runtime rejects that), so only the static keys need checking; an index
 * past them is refused anyway. Exactly one Flash instruction (one position),
 * a capped priority fee, and ATA creates paid for and owned by `owner` only.
 * The collateral inside the Flash instruction is not decoded: the hedge
 * wallet's own small balance is what bounds it (loadHedgeKeypair).
 */
export function verifyHedgeTx(
  tx: VersionedTransaction,
  owner: PublicKey,
  allowed: ReadonlySet<string> = HEDGE_PROGRAM_ALLOWLIST,
  maxPriorityMicroLamports = HEDGE_MAX_PRIORITY_MICRO_LAMPORTS,
): { ok: true } | { ok: false; reason: string } {
  const msg = tx.message;
  const keys = msg.staticAccountKeys;
  if (keys.length === 0 || !keys[0].equals(owner)) {
    return { ok: false, reason: `fee payer ${keys[0]?.toBase58() ?? "(none)"} is not ${owner.toBase58()}` };
  }
  if (msg.compiledInstructions.length === 0) return { ok: false, reason: "no instructions" };
  const flash = new Set<string>(FLASH_PERP_PROGRAM_IDS);
  let flashCount = 0;
  for (const ix of msg.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    if (!program) return { ok: false, reason: `instruction program index ${ix.programIdIndex} is not a static key` };
    const id = program.toBase58();
    if (!allowed.has(id)) return { ok: false, reason: `program ${id} is not allowlisted` };
    const data = Buffer.from(ix.data);
    if (flash.has(id)) flashCount++;
    if (id === COMPUTE_BUDGET_ID) {
      if (data[0] === 3) {
        if (data.length < 9 || data.readBigUInt64LE(1) > BigInt(maxPriorityMicroLamports)) {
          return { ok: false, reason: "priority fee above the configured maximum" };
        }
      } else if (data[0] !== 2) {
        return { ok: false, reason: `unsupported ComputeBudget instruction ${data[0]}` };
      }
    }
    if (id === ATA_ID) {
      // Create / CreateIdempotent only; accounts: [payer, ata, wallet, mint, ...].
      if (data.length > 1 || (data.length === 1 && data[0] > 1)) return { ok: false, reason: "unsupported ATA instruction" };
      const payer = keys[ix.accountKeyIndexes[0]];
      const wallet = keys[ix.accountKeyIndexes[2]];
      if (!payer?.equals(owner) || !wallet?.equals(owner)) return { ok: false, reason: "ATA create for another wallet" };
    }
  }
  if (flashCount !== 1) return { ok: false, reason: `expected exactly one Flash instruction, got ${flashCount}` };
  return { ok: true };
}
