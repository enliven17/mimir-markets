/**
 * Polymarket finality from the Gamma API record, read deterministically
 * instead of asking a model whether a page "looks resolved".
 *
 * A market is final only when Gamma says `closed: true` AND
 * `umaResolutionStatus: "resolved"` (older markets carry no UMA status: there
 * closed with outcome prices at exactly 1/0 counts): trading stopping is not a
 * result, and a proposal still in UMA's dispute window can flip. The winning
 * side is read from `outcomePrices` (the resolved outcome pays 1).
 *
 * The claim names the market; the oracle builds the Gamma query itself. Only
 * polymarket.com/market/<slug>, polymarket.com/event/<slug>[/<market slug>]
 * and the market creator's canonical gamma `/markets?slug=<slug>` are
 * accepted: a raw Gamma URL (`?id=`, `?closed=true&limit=1`, ...) could point
 * the deterministic path at any market at all. Even then the market is only
 * trusted when it is bound to the claim (polymarketBinding): it ends by the
 * claim's deadline, was not already closed when the claim was created, and
 * asks the same question. Anything else takes the normal path.
 */
import { stripResolverFragment } from "../../lib/resolver-spec";

const GAMMA_HOST = "gamma-api.polymarket.com";
const SLUG = /^[a-z0-9-]{1,200}$/i;

/** A market's end date may run this far past the claim's deadline (clock/rounding slack). */
export const POLYMARKET_END_DATE_TOLERANCE_SECS = 3600;
/** Share of the market question's words the claim question must contain. */
export const POLYMARKET_QUESTION_MATCH_MIN = 0.6;

export interface PolymarketRef {
  kind: "market" | "event";
  slug: string;
}

export interface PolymarketStatus {
  /** closed and resolved by UMA */
  resolved: boolean;
  /** When resolved cleanly: did "Yes" pay 1? Null for a 50/50 or unreadable resolution. */
  yesWon: boolean | null;
}

/** The market (or single-market event) a claim's resolution URL names, or null. */
export function polymarketRefFor(resolutionUrl: string): PolymarketRef | null {
  let url: URL;
  try {
    url = new URL(stripResolverFragment(resolutionUrl));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === GAMMA_HOST) {
    // Only the canonical single-slug form; every other Gamma query is refused.
    const keys = [...url.searchParams.keys()];
    const slug = url.searchParams.get("slug") ?? "";
    if (url.pathname !== "/markets" || keys.length !== 1 || keys[0] !== "slug" || !SLUG.test(slug)) return null;
    return { kind: "market", slug };
  }
  if (host !== "polymarket.com" && host !== "www.polymarket.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  let ref: PolymarketRef | null = null;
  if (parts[0] === "market" && parts.length === 2) ref = { kind: "market", slug: parts[1] };
  else if (parts[0] === "event" && parts.length === 2) ref = { kind: "event", slug: parts[1] };
  else if (parts[0] === "event" && parts.length === 3) ref = { kind: "market", slug: parts[2] };
  return ref && SLUG.test(ref.slug) ? ref : null;
}

/** The Gamma query for a reference: markets by slug, or events by slug. */
export function gammaQueryUrl(ref: PolymarketRef): string {
  return `https://${GAMMA_HOST}/${ref.kind === "event" ? "events" : "markets"}?slug=${encodeURIComponent(ref.slug)}`;
}

/** The Gamma URL for a claim's Polymarket resolution URL, or null when it cannot be mapped to one market. */
export function gammaUrlFor(resolutionUrl: string): string | null {
  const ref = polymarketRefFor(resolutionUrl);
  return ref ? gammaQueryUrl(ref) : null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * The one market a Gamma response describes, or null. Markets: exactly one
 * row. Events: exactly one event holding exactly one market (a multi-market
 * event does not say which market the claim is about).
 */
export function marketFromGamma(body: unknown, kind: PolymarketRef["kind"] = "market"): Record<string, unknown> | null {
  const rows = Array.isArray(body) ? body : isRecord(body) ? [body] : [];
  if (rows.length !== 1 || !isRecord(rows[0])) return null;
  if (kind === "market") return rows[0];
  const markets = rows[0].markets;
  return Array.isArray(markets) && markets.length === 1 && isRecord(markets[0]) ? markets[0] : null;
}

/** Finality of one Gamma market record. */
export function polymarketStatusOf(m: Record<string, unknown>): PolymarketStatus {
  const outcomes = stringArray(m.outcomes).map((o) => o.toLowerCase());
  const prices = stringArray(m.outcomePrices).map(Number);
  const yes = outcomes.indexOf("yes");
  const binary = outcomes.length === 2 && yes !== -1 && prices.length === 2;
  const settledPrices = binary && prices.every((p) => p === 0 || p === 1) && prices[0] + prices[1] === 1;
  const hasUmaStatus = typeof m.umaResolutionStatus === "string" && m.umaResolutionStatus !== "";
  const resolved = m.closed === true && (hasUmaStatus ? m.umaResolutionStatus === "resolved" : settledPrices);
  if (!resolved || !binary) return { resolved, yesWon: null };
  const p = prices[yes];
  return { resolved, yesWon: p === 1 ? true : p === 0 ? false : null };
}

/** Status of the one market a Gamma `/markets` response describes; null when it is not exactly one market. */
export function parsePolymarketStatus(body: unknown): PolymarketStatus | null {
  const m = marketFromGamma(body, "market");
  return m ? polymarketStatusOf(m) : null;
}

/** Gamma timestamps come as ISO or as Postgres text ("2026-10-03 11:58:12.32+00"); ms epoch or NaN. */
export function parseGammaTime(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return NaN;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)?(?::\d{2})?$/i.exec(value.trim());
  if (!m) return Date.parse(value);
  let zone = m[3] ?? "Z";
  if (/^[+-]\d{2}$/.test(zone)) zone = `${zone}:00`;
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return Date.parse(`${m[1]}T${m[2]}${zone.toUpperCase()}`);
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "by", "to", "for", "and", "or", "be", "is", "will", "at", "per", "before", "after",
  "polymarket", "closes", "close", "than", "this", "that", "with", "from", "as", "it", "its",
]);

function words(text: string): Set<string> {
  return new Set(
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w)),
  );
}

/** Share of the market question's words that the claim question also has. */
export function questionOverlap(marketQuestion: string, claimQuestion: string): number {
  const m = words(marketQuestion);
  if (m.size === 0) return 0;
  const c = words(claimQuestion);
  let hit = 0;
  for (const w of m) if (c.has(w)) hit++;
  return hit / m.size;
}

/**
 * Why this market may not settle this claim, or null when it may: it must end
 * by the claim's deadline (plus a small tolerance), must not have been closed
 * already when the claim was created (a claim on a decided market is a free
 * option), and must ask the claim's question.
 */
export function polymarketBinding(
  m: Record<string, unknown>,
  claim: { question: string; deadline: number; createdAt: number },
): string | null {
  const endMs = parseGammaTime(m.endDate);
  if (!Number.isFinite(endMs)) return "the market has no readable end date";
  if (endMs > (claim.deadline + POLYMARKET_END_DATE_TOLERANCE_SECS) * 1000) return "the market ends after the claim's deadline";
  const closedTimes = [m.closedTime, m.umaEndDate].map(parseGammaTime).filter(Number.isFinite);
  if (m.closed === true && closedTimes.length === 0) return "the market is closed with no readable close time";
  if (!Number.isFinite(claim.createdAt) || claim.createdAt <= 0) return "the claim has no creation time";
  if (closedTimes.some((t) => t <= claim.createdAt * 1000)) return "the market had already closed when the claim was created";
  const overlap = questionOverlap(String(m.question ?? ""), claim.question);
  if (overlap < POLYMARKET_QUESTION_MATCH_MIN) return `the market question does not match the claim (${Math.round(overlap * 100)}% overlap)`;
  return null;
}
