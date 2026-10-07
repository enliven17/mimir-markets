/**
 * The open markets, for the Telegram /markets command and its card (app/api/telegram/markets-card): live markets,
 * closing soonest first, from the backend index.
 */
import { arcMarketList } from "./arc-index";
import { filterMarkets, toPublic, type IndexedMarket, type PublicMarket } from "./public-markets";

export async function openMarkets(limit: number, now = Math.floor(Date.now() / 1000)): Promise<{ total: number; markets: PublicMarket[] }> {
  const rows = (await arcMarketList()) as IndexedMarket[];
  const live = filterMarkets(rows.map((m) => toPublic(m, now)), "live", now).sort((a, b) => a.deadline - b.deadline);
  return { total: live.length, markets: live.slice(0, limit) };
}

/** "2d 4h", "35m", "closing". */
export function timeLeft(deadline: number, now = Math.floor(Date.now() / 1000)): string {
  const s = deadline - now;
  if (s <= 60) return "closing";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
