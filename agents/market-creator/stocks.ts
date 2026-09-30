/**
 * Stock claims on a fixed roster of liquid large-caps.
 *
 * No price feed is needed: a claim is framed as the day's direction ("close
 * above its previous close"), which the oracle reads off the stockanalysis.com
 * quote page's day change. The deadline is shortly after the next regular
 * session close (16:00 America/New_York). Exchange holidays are not modelled;
 * a claim on a closed day has no day change to read and refunds as
 * unresolvable.
 */
import { formatDay, toDeadline, type DraftClaim } from "./draft";

export const STOCK_TICKERS: Array<{ symbol: string; name: string }> = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
];

/** Minutes after the close before the claim's deadline, so the page has the final print. */
const AFTER_CLOSE_MIN = 20;
/** A session closing sooner than this is skipped for the next one. */
const MIN_LEAD_MS = 2 * 3_600_000;

/** New York's UTC offset in minutes (−240 in summer, −300 in winter) at `ms`. */
function nyOffsetMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(ms));
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const m = tz.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return -300;
  const h = Number(m[1]);
  return h * 60 + Math.sign(h) * Number(m[2] ?? 0);
}

/** ms epoch of the next weekday 16:00 New York close at least MIN_LEAD_MS away. */
export function nextSessionClose(now = Date.now()): number {
  for (let day = 0; day < 8; day++) {
    const d = new Date(now + day * 86_400_000);
    // The calendar date in New York for that instant.
    const ny = new Date(d.getTime() + nyOffsetMinutes(d.getTime()) * 60_000);
    const weekday = ny.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const closeGuess = Date.UTC(ny.getUTCFullYear(), ny.getUTCMonth(), ny.getUTCDate(), 16, 0);
    const close = closeGuess - nyOffsetMinutes(closeGuess) * 60_000;
    if (close - now >= MIN_LEAD_MS) return close;
  }
  throw new Error("no session close within a week");
}

export function stockResolutionUrl(symbol: string): string {
  return `https://stockanalysis.com/stocks/${symbol.toLowerCase()}/`;
}

export function stockDraft(t: { symbol: string; name: string }, closeMs: number): DraftClaim {
  const day = formatDay(closeMs);
  return {
    question: `Will ${t.name} (${t.symbol}) close above its previous close on ${day}?`,
    creatorPosition: `Yes: ${t.symbol} closes up on the day`,
    counterPosition: `No: ${t.symbol} closes flat or down on the day`,
    category: "stocks",
    resolutionUrl: stockResolutionUrl(t.symbol),
    settlementRule:
      `Resolve from the day change on the linked stockanalysis.com quote page after the ${day} close: ` +
      `Side A wins if ${t.symbol} closed above the previous close. Deadline ${new Date(closeMs).toISOString()} UTC.`,
    deadline: toDeadline(closeMs + AFTER_CLOSE_MIN * 60_000),
    source: "stocks",
    label: `${t.symbol} up on ${day}`,
  };
}

/** `count` tickers for the next session, rotating through the roster by day. */
export function draftStockClaims(count: number, now = Date.now()): DraftClaim[] {
  if (count <= 0) return [];
  const close = nextSessionClose(now);
  const start = Math.floor(close / 86_400_000) % STOCK_TICKERS.length;
  const out: DraftClaim[] = [];
  for (let i = 0; i < Math.min(count, STOCK_TICKERS.length); i++) {
    out.push(stockDraft(STOCK_TICKERS[(start + i) % STOCK_TICKERS.length], close));
  }
  return out;
}
