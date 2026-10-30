/**
 * Shared GeckoTerminal reads for every token-trading venue.
 *
 * The venue changes the network path (solana, robinhood, ...); the worker sees
 * the same ShieldBot and technical interfaces everywhere. Reads are cached and
 * failures return null so the worker can fail closed without blocking a tick.
 */
import type { Candidate, TechnicalFeed } from "../ports";
import { assessShield, type SafetyFeed, type Shield, type ShieldInfo, type ShieldTrade } from "../engine/shield";
import { readBars, type Bar, type TechnicalRead } from "../engine/ta";
import { getJson, ttlCache, type FetchLike, type OnError } from "./http";

const GT = "https://api.geckoterminal.com/api/v2/networks";

type RawTrade = { attributes?: { kind?: string; tx_from_address?: string; from_token_amount?: string; to_token_amount?: string; block_timestamp?: string } };

export type GeckoFeedOptions = {
  network: string;
  fetch?: FetchLike;
  onError?: OnError;
  ttlMs?: number;
  timeoutMs?: number;
};

const endpoint = (network: string, path: string) => `${GT}/${encodeURIComponent(network)}/${path}`;

/** One common ShieldBot implementation for Solana, Robinhood and future GeckoTerminal venues. */
export function createGeckoSafety(opts: GeckoFeedOptions): SafetyFeed {
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  const cache = ttlCache<Shield>(opts.ttlMs ?? 3 * 60_000);
  return {
    async check(candidate: Candidate): Promise<Shield | null> {
      if (!candidate.pool) return null;
      const key = `${opts.network}:${candidate.mint}`;
      try {
        return await cache.get(key, async () => {
          const [infoBody, tradesBody] = await Promise.all([
            getJson(fetchFn, endpoint(opts.network, `tokens/${candidate.mint}/info`), { timeoutMs: opts.timeoutMs }) as Promise<{ data?: { attributes?: ShieldInfo } }>,
            getJson(fetchFn, endpoint(opts.network, `pools/${candidate.pool}/trades`), { timeoutMs: opts.timeoutMs }) as Promise<{ data?: RawTrade[] }>,
          ]);
          const trades: ShieldTrade[] = (tradesBody.data ?? []).flatMap((t) => {
            const a = t.attributes ?? {};
            const kind = a.kind === "buy" ? "buy" : a.kind === "sell" ? "sell" : null;
            const from = a.tx_from_address ?? "";
            const native = Number(kind === "buy" ? a.from_token_amount : a.to_token_amount) || 0;
            const tokens = Number(kind === "buy" ? a.to_token_amount : a.from_token_amount) || 0;
            const at = Date.parse(a.block_timestamp ?? "") || 0;
            return kind && from ? [{ kind, from, native, tokens, at }] : [];
          });
          return assessShield(infoBody.data?.attributes ?? {}, trades);
        });
      } catch (err) {
        opts.onError?.(`geckoterminal:${opts.network}:shield`, err);
        return null;
      }
    },
  };
}

/** Shared OHLCV technical read. Pons and launchpad tokens use minute candles; graduated pools use 5m candles. */
export function createGeckoTechnical(opts: GeckoFeedOptions): TechnicalFeed {
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  const cache = ttlCache<TechnicalRead | null>(opts.ttlMs ?? 30_000);
  return {
    async read(candidate: Candidate) {
      if (!candidate.pool) return null;
      const aggregate = candidate.source === "pumpfun" ? 1 : 5;
      const key = `${opts.network}:${candidate.pool}:${aggregate}`;
      try {
        return await cache.get(key, async () => {
          const body = (await getJson(fetchFn, endpoint(opts.network, `pools/${candidate.pool}/ohlcv/minute?aggregate=${aggregate}&limit=300&currency=token`), { timeoutMs: opts.timeoutMs })) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
          const bars: Bar[] = (body.data?.attributes?.ohlcv_list ?? [])
            .map(([time, open, high, low, close, volume]) => ({ time: time ?? 0, open: open ?? 0, high: high ?? 0, low: low ?? 0, close: close ?? 0, volume: volume ?? 0 }))
            .filter((b) => [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite))
            .reverse();
          return readBars(bars);
        });
      } catch (err) {
        opts.onError?.(`geckoterminal:${opts.network}:ohlcv`, err);
        return null;
      }
    },
  };
}
