// Whale buys via the Helius Enhanced Transactions API: poll each watched wallet's recent parsed
// transactions and surface tokens it bought in the last N minutes.
//
// Verified 2026-10-05 against the OpenAPI spec https://www.helius.dev/docs/openapi/openapi-definition.yaml
// and https://www.helius.dev/docs/api-reference/enhanced-transactions/gettransactionsbyaddress :
//   GET https://mainnet.helius-rpc.com/v0/addresses/{address}/transactions?api-key=KEY&gte-time=<unix s>&limit=1..100
//   → EnhancedTransaction[] { signature, timestamp, type, source, transactionError,
//       nativeTransfers:[{fromUserAccount,toUserAccount,amount(lamports)}],
//       tokenTransfers:[{fromUserAccount,toUserAccount,mint,tokenAmount(UI number)}],
//       events:{ swap:{ nativeInput:{account,amount}, tokenOutputs:[{userAccount,mint,rawTokenAmount}] } } }
// Note (docs, 2026): this endpoint is in maintenance mode (no new parsers) but still served.
// A "buy" here = the whale received a non-quote token and paid SOL/wSOL in the same transaction.
import type { Candidate, MarketSource } from "../ports";
import { isMint } from "../engine/candidates";
import { WSOL_MINT } from "../engine/sol";
import { getJson, num, ttlCache } from "./http";
import type { FetchLike, OnError } from "./http";

export const HELIUS_BASE = "https://mainnet.helius-rpc.com";
const QUOTE_MINTS = new Set([
  WSOL_MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

export type HeliusOptions = {
  apiKey?: string;
  fetch?: FetchLike;
  now?: () => number;
  onError?: OnError;
  timeoutMs?: number;
  /** How far back a buy counts. */
  windowMinutes?: number;
  /** Ignore buys smaller than this, SOL. */
  minBuySol?: number;
  maxWhales?: number;
  /** Per-wallet poll cache; bounds API credits regardless of how many agents watch the wallet. */
  ttlMs?: number;
};

type Tx = {
  signature?: string;
  timestamp?: number;
  transactionError?: unknown;
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[];
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }[];
};

export type WhaleBuy = { whale: string; mint: string; sol: number; at: number; sig: string };

/** Buys by `whale` in one parsed transaction (normally 0 or 1). */
export function buysIn(tx: Tx, whale: string): WhaleBuy[] {
  if (!tx || tx.transactionError) return [];
  let solOut = 0;
  for (const t of tx.nativeTransfers ?? []) {
    const amt = num(t.amount) ?? 0;
    if (t.fromUserAccount === whale) solOut += amt / 1e9;
    if (t.toUserAccount === whale) solOut -= amt / 1e9;
  }
  const received = new Set<string>();
  for (const t of tx.tokenTransfers ?? []) {
    const amt = num(t.tokenAmount) ?? 0;
    if (t.mint === WSOL_MINT) {
      if (t.fromUserAccount === whale) solOut += amt;
      if (t.toUserAccount === whale) solOut -= amt;
    } else if (t.toUserAccount === whale && amt > 0 && isMint(t.mint) && !QUOTE_MINTS.has(t.mint)) {
      received.add(t.mint);
    }
  }
  if (solOut <= 0 || received.size === 0) return [];
  const at = (num(tx.timestamp) ?? 0) * 1000;
  return [...received].map((mint) => ({ whale, mint, sol: solOut / received.size, at, sig: tx.signature ?? "" }));
}

export function createHeliusSource(opts: HeliusOptions): MarketSource {
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? Date.now;
  const windowMs = (opts.windowMinutes ?? 10) * 60_000;
  const cache = ttlCache<Tx[]>(opts.ttlMs ?? 60_000, now);

  async function recent(whale: string, signal?: AbortSignal): Promise<Tx[]> {
    return cache.get(whale, async () => {
      const since = Math.floor((now() - windowMs) / 1000);
      const url = `${HELIUS_BASE}/v0/addresses/${whale}/transactions?api-key=${encodeURIComponent(opts.apiKey ?? "")}&gte-time=${since}&limit=50`;
      const body = await getJson(fetchFn, url, { timeoutMs: opts.timeoutMs ?? 10_000, signal, redact: opts.apiKey });
      return Array.isArray(body) ? (body as Tx[]) : [];
    });
  }

  return {
    id: "helius",
    async candidates({ whales, signal }) {
      if (!opts.apiKey) return [];
      const list = [...new Set(whales.filter(isMint))].slice(0, opts.maxWhales ?? 20);
      if (list.length === 0) return [];
      const cutoff = now() - windowMs;
      const buys: WhaleBuy[] = [];
      const results = await Promise.allSettled(list.map(async (w) => ({ w, txs: await recent(w, signal) })));
      for (const r of results) {
        if (r.status === "rejected") {
          opts.onError?.("helius", r.reason);
          continue;
        }
        for (const tx of r.value.txs) buys.push(...buysIn(tx, r.value.w).filter((b) => b.at >= cutoff && b.sol >= (opts.minBuySol ?? 0.1)));
      }
      return aggregate(buys, now());
    },
  };
}

function aggregate(buys: WhaleBuy[], now: number): Candidate[] {
  const byMint = new Map<string, WhaleBuy[]>();
  for (const b of buys) byMint.set(b.mint, [...(byMint.get(b.mint) ?? []), b]);
  return [...byMint].map(([mint, list]) => {
    const whales = new Set(list.map((b) => b.whale));
    const sol = list.reduce((s, b) => s + b.sol, 0);
    const latest = Math.max(...list.map((b) => b.at));
    const mins = Math.max(0, Math.round((now - latest) / 60_000));
    const who = [...whales].slice(0, 3).map((w) => `${w.slice(0, 4)}…`).join(", ");
    return {
      mint,
      symbol: "",
      source: "helius" as const,
      priceSol: null,
      metrics: {},
      note: `${whales.size} whale${whales.size > 1 ? "s" : ""} (${who}) bought ${sol.toFixed(2)} SOL, latest ${mins}m ago`,
    };
  });
}
