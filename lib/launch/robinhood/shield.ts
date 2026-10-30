/** GeckoTerminal adapter for the engine's ShieldBot safety assessment on Pons. */
import type { Candidate } from "../ports";
import { assessShield, type Shield, type ShieldInfo, type ShieldTrade, type SafetyFeed } from "../engine/shield";
import { getJson, ttlCache, type FetchLike, type OnError } from "../market/http";

const BASE = "https://api.geckoterminal.com/api/v2/networks/robinhood";

type RawTrade = { attributes?: { kind?: string; tx_from_address?: string; from_token_amount?: string; to_token_amount?: string; block_timestamp?: string } };

export type PonsShieldOptions = { fetch?: FetchLike; onError?: OnError; ttlMs?: number; timeoutMs?: number };

/** Safety reads are cached across all agents so a busy deployment stays under GeckoTerminal's limit. */
export function createPonsShield(opts: PonsShieldOptions = {}): SafetyFeed {
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  const cache = ttlCache<Shield>(opts.ttlMs ?? 3 * 60_000);
  return {
    async check(candidate: Candidate): Promise<Shield | null> {
      if (!candidate.pool) return null;
      const key = candidate.mint.toLowerCase();
      try {
        return await cache.get(key, async () => {
          const [infoBody, tradesBody] = await Promise.all([
            getJson(fetchFn, `${BASE}/tokens/${key}/info`, { timeoutMs: opts.timeoutMs }) as Promise<{ data?: { attributes?: ShieldInfo } }>,
            getJson(fetchFn, `${BASE}/pools/${candidate.pool!.toLowerCase()}/trades`, { timeoutMs: opts.timeoutMs }) as Promise<{ data?: RawTrade[] }>,
          ]);
          const raw = tradesBody.data ?? [];
          const trades: ShieldTrade[] = raw.flatMap((t) => {
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
        opts.onError?.("geckoterminal:shield", err);
        return null;
      }
    },
  };
}
