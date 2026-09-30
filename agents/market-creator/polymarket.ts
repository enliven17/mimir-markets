/**
 * Polymarket as a candidate source.
 *
 * Invented questions are the weak link in a market creator: the threshold
 * turns out to be one nobody can check. Polymarket's live book is the
 * opposite: every question there is already written to be settleable, already
 * has a resolution date, and already has real money pricing it.
 *
 * What is borrowed is the *question*, not the market. Mimir opens its own
 * claim, with its own stake, settled by its own oracle. The resolution URL is
 * the market's Gamma API record (question, rules, `closed`,
 * `umaResolutionStatus`, final prices) rather than the JS-rendered page, so
 * the oracle reads the outcome instead of scraping it. The oracle waits for
 * the UMA resolution before settling (agents/oracle/decide.ts, 72h grace).
 * The Polymarket price is used only to skip questions that are already
 * decided: a market trading at 97% is not a bet, it is a formality.
 */
import { clampBytes, formatDay, MAX_QUESTION_BYTES, toDeadline, type DraftClaim } from "./draft";

export interface PolymarketCandidate {
  question: string;
  slug: string;
  /** The public market page, for people. */
  url: string;
  /** Probability of "yes", 0 to 1, as the book currently prices it. */
  probability: number;
  /** ms epoch. */
  endDate: number;
  liquidityUsd: number;
  volumeUsd: number;
  category: string;
}

const GAMMA_BASE = "https://gamma-api.polymarket.com";

/** Questions this crowded are settled in all but name. */
export const MAX_PROBABILITY = 0.9;
export const MIN_PROBABILITY = 0.1;

/** Below this there is no crowd, so the question carries no signal. */
export const MIN_LIQUIDITY_USD = 5_000;

/** A market resolving inside this window cannot be challenged in time. */
export const MIN_HOURS_TO_END = 12;
/** Past this, nobody can price it and the claim just sits open. */
export const MAX_HOURS_TO_END = 90 * 24;

interface RawMarket {
  question?: unknown;
  slug?: unknown;
  endDate?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  liquidityNum?: unknown;
  volumeNum?: unknown;
  closed?: unknown;
  active?: unknown;
  archived?: unknown;
  category?: unknown;
}

/** Gamma returns these as JSON-encoded strings, not arrays. */
function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Turn one raw Gamma market into a candidate, or null. Exported so the
 * filtering is tested against recorded payloads without a network.
 */
export function toCandidate(raw: RawMarket, now = Date.now()): PolymarketCandidate | null {
  if (raw.closed === true || raw.archived === true || raw.active === false) return null;

  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
  if (!question || !slug) return null;

  // Binary only. A multi-outcome market does not map onto a two-sided claim.
  const outcomes = parseStringArray(raw.outcomes).map((o) => o.toLowerCase());
  if (outcomes.length !== 2) return null;
  const yesIndex = outcomes.indexOf("yes");
  if (yesIndex === -1) return null;

  const prices = parseStringArray(raw.outcomePrices).map(Number);
  if (prices.length !== 2 || prices.some((p) => !Number.isFinite(p))) return null;
  const probability = prices[yesIndex];
  if (probability < MIN_PROBABILITY || probability > MAX_PROBABILITY) return null;

  const endDate = raw.endDate ? Date.parse(String(raw.endDate)) : NaN;
  if (!Number.isFinite(endDate)) return null;
  const hoursOut = (endDate - now) / 3_600_000;
  if (hoursOut < MIN_HOURS_TO_END || hoursOut > MAX_HOURS_TO_END) return null;

  const liquidityUsd = num(raw.liquidityNum);
  if (liquidityUsd < MIN_LIQUIDITY_USD) return null;

  return {
    question,
    slug,
    url: `https://polymarket.com/market/${slug}`,
    probability,
    endDate,
    liquidityUsd,
    volumeUsd: num(raw.volumeNum),
    category: typeof raw.category === "string" && raw.category ? raw.category : "custom",
  };
}

/**
 * Closeness to even money first: a question the crowd cannot agree on is the
 * one worth putting in front of people. Liquidity breaks ties, because a
 * contested question nobody has money on is usually just an unclear one.
 */
export function rankCandidates(candidates: PolymarketCandidate[]): PolymarketCandidate[] {
  return [...candidates].sort((a, b) => {
    const aBalance = Math.abs(a.probability - 0.5);
    const bBalance = Math.abs(b.probability - 0.5);
    if (Math.abs(aBalance - bBalance) > 0.02) return aBalance - bBalance;
    return b.liquidityUsd - a.liquidityUsd;
  });
}

export function isPolymarketEnabled(): boolean {
  const raw = process.env.MARKET_CREATOR_POLYMARKET?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

/** The Gamma record for one market: what the claim settles from. */
export function polymarketApiUrl(slug: string): string {
  return `${GAMMA_BASE}/markets?slug=${encodeURIComponent(slug)}`;
}

/**
 * Fetch open binary markets worth borrowing a question from. The end-date
 * window is pushed into the query: sorted by liquidity alone, the top of the
 * book is years-out elections and nothing survives the horizon filter.
 * Fails soft: a source being down is not a reason to skip a whole run.
 */
export async function fetchPolymarketCandidates(limit = 12, now = Date.now()): Promise<PolymarketCandidate[]> {
  const minEnd = new Date(now + MIN_HOURS_TO_END * 3_600_000).toISOString();
  const maxEnd = new Date(now + MAX_HOURS_TO_END * 3_600_000).toISOString();
  const url =
    `${GAMMA_BASE}/markets?closed=false&archived=false&active=true` +
    `&limit=120&order=liquidityNum&ascending=false` +
    `&end_date_min=${encodeURIComponent(minEnd)}&end_date_max=${encodeURIComponent(maxEnd)}`;

  let raw: RawMarket[];
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[creator] polymarket returned HTTP ${res.status}`);
      return [];
    }
    const body = await res.json();
    raw = Array.isArray(body) ? body : [];
  } catch (err) {
    console.warn("[creator] polymarket fetch failed:", err instanceof Error ? err.message : err);
    return [];
  }

  const candidates = raw
    .map((m) => toCandidate(m, now))
    .filter((c): c is PolymarketCandidate => c !== null);
  return rankCandidates(candidates).slice(0, limit);
}

/**
 * A chain-ready claim from a candidate, or null when it does not fit.
 *
 * The question keeps Polymarket's wording and names the settlement and the
 * close date up front, so the claim states its own rule (there is no separate
 * rule field on chain). The deadline is the market's own end date: betting
 * closes when trading does, and the oracle then waits for UMA.
 */
export function polymarketDraft(c: PolymarketCandidate): DraftClaim | null {
  const closes = formatDay(c.endDate);
  const question = `Per Polymarket (closes on or before ${closes}): ${c.question}`;
  if (Buffer.byteLength(question, "utf8") > MAX_QUESTION_BYTES) return null;
  const short = clampBytes(c.question.replace(/\?$/, ""), 60);
  return {
    question,
    creatorPosition: "Yes: Polymarket resolves this market YES",
    counterPosition: "No: Polymarket resolves this market NO",
    // Not "sports" even for sports markets: that category takes the oracle's 12h
    // match grace, and a UMA resolution needs the 72h Polymarket one.
    category: "custom",
    resolutionUrl: polymarketApiUrl(c.slug),
    settlementRule:
      `Resolve from the linked Polymarket API record once the market is closed and UMA has resolved it: ` +
      `Side A wins if the Yes outcome settles at 1, Side B if No does. Deadline ${new Date(c.endDate).toISOString()} UTC.`,
    deadline: toDeadline(c.endDate),
    source: "polymarket",
    label: `${short} (${Math.round(c.probability * 100)}% yes)`,
  };
}
