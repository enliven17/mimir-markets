/**
 * Shared evidence fetcher for Mimir.
 *
 * Used by:
 *   - lib/server/source-claim-generator.ts (drafts: helps users propose claims)
 *   - agents/oracle/index.ts (resolution: settles expired claims on-chain)
 *
 * Strategy:
 *   1. Host-routed handlers for sources with clean public APIs (deterministic,
 *      LLM-friendly snapshots). Today: CoinGecko.
 *   2. For everything else: direct fetch first. If we hit a Cloudflare
 *      "verify you're human" interstitial or a forbidden response, fall back
 *      to Jina Reader (https://r.jina.ai/URL) which renders the page via a
 *      managed browser farm and returns markdown.
 *
 * The returned snapshot's `fetcher` field tells callers where the text came
 * from so they can adjust trust (e.g. oracle downgrades confidence when the
 * evidence came via Jina rather than a structured API).
 */

import { gatewayFetch, GatewayRejectedError } from "../research/gateway";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CHARS = 14_000;
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const JINA_READER_BASE = "https://r.jina.ai/";

// Markers that strongly suggest we got an anti-bot interstitial instead of
// actual content. Keep this list conservative — false positives mean we
// uselessly burn a Jina fallback call.
const CLOUDFLARE_MARKERS = [
  "verifying you are human",
  "needs to review the security of your connection",
  "just a moment",
  "challenges.cloudflare.com",
  "cf-browser-verification",
  "__cf_chl_",
  "attention required! | cloudflare",
] as const;

export type EvidenceFetcherKind = "coingecko-api" | "flashtrade-api" | "espn-api" | "direct" | "jina";

export interface EvidenceSnapshot {
  /** Normalized final URL (after redirects when applicable). */
  sourceUrl: string;
  /** Best-effort page title; empty string when unavailable. */
  title: string;
  /** Plain text suitable for LLM consumption. Already truncated to maxChars. */
  text: string;
  /** ms epoch when the fetch completed. */
  fetchedAt: number;
  /** Which path produced this snapshot. Callers can use this to gate trust. */
  fetcher: EvidenceFetcherKind;
}

export class EvidenceFetchError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = "EvidenceFetchError";
  }
}

export interface FetchEvidenceOptions {
  /** Override the per-request char cap. Defaults to 14k. */
  maxChars?: number;
  /** Custom User-Agent for direct fetches. */
  userAgent?: string;
  /** Total request timeout in ms. Defaults to 15s. */
  timeoutMs?: number;
  /** When true, skip the Jina fallback and let direct failures bubble up. */
  disableJinaFallback?: boolean;
}

export async function fetchEvidence(
  rawUrl: string,
  opts: FetchEvidenceOptions = {},
): Promise<EvidenceSnapshot> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new EvidenceFetchError("Invalid URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new EvidenceFetchError("Unsupported URL protocol");
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "coingecko.com") {
    const snap = await fetchCoinGeckoSnapshot(parsed, opts);
    if (snap) return snap;
  }

  if (host === "flashapi.trade") {
    const snap = await fetchFlashTradeSnapshot(parsed, opts);
    if (snap) return snap;
  }

  if (host === "site.api.espn.com") {
    const snap = await fetchEspnSnapshot(parsed, opts);
    if (snap) return snap;
  }

  return fetchGenericSnapshot(parsed, opts);
}

// ── Generic path: direct fetch, then Jina fallback ────────────────────────

async function fetchGenericSnapshot(
  url: URL,
  opts: FetchEvidenceOptions,
): Promise<EvidenceSnapshot> {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = opts.userAgent ?? "Mimir-Bot/1.0 (+https://mimir.app)";

  const direct = await tryDirectFetch(url, { timeoutMs, userAgent });

  if (direct.ok && !looksLikeCloudflareInterstitial(direct.body)) {
    const text = stripHtml(direct.body).slice(0, maxChars);
    if (text.length >= 200) {
      return {
        sourceUrl: direct.finalUrl,
        title: extractTitle(direct.body),
        text,
        fetchedAt: Date.now(),
        fetcher: "direct",
      };
    }
    // Body parsed but is too short to be useful — fall through to Jina.
  }

  if (opts.disableJinaFallback) {
    throw new EvidenceFetchError(
      direct.ok
        ? "Source returned a bot-protection page"
        : `Unable to fetch source (${direct.statusCode ?? "network error"})`,
      direct.statusCode,
    );
  }

  const jina = await fetchViaJina(url, { timeoutMs, maxChars });
  return jina;
}

interface DirectFetchResult {
  ok: boolean;
  body: string;
  finalUrl: string;
  statusCode?: number;
}

async function tryDirectFetch(
  url: URL,
  args: { timeoutMs: number; userAgent: string },
): Promise<DirectFetchResult> {
  const finalUrl = url.toString();
  try {
    // Through the research gateway, never a bare fetch: the URL comes from
    // whoever created the claim, and a public host is free to redirect into
    // our own network on the second hop.
    const response = await gatewayFetch(finalUrl, {
      headers: {
        "User-Agent": args.userAgent,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
      },
      timeoutMs: args.timeoutMs,
    });

    const isTexty = /text\/html|application\/xhtml\+xml|text\/plain|application\/json/i.test(
      response.contentType,
    );
    const okStatus = response.status >= 200 && response.status < 300;

    if (!okStatus || !isTexty) {
      return { ok: false, body: "", finalUrl: response.finalUrl, statusCode: response.status };
    }
    return { ok: true, body: response.body, finalUrl: response.finalUrl, statusCode: response.status };
  } catch (err) {
    if (err instanceof GatewayRejectedError) {
      // A refused hop is a property of the source, not a transient blip, so it
      // is worth surfacing rather than silently retrying through Jina.
      console.warn(`[evidence] gateway refused ${finalUrl}: ${err.reason} - ${err.message}`);
    }
    return { ok: false, body: "", finalUrl };
  }
}

async function fetchViaJina(
  url: URL,
  args: { timeoutMs: number; maxChars: number },
): Promise<EvidenceSnapshot> {
  const jinaUrl = `${JINA_READER_BASE}${url.toString()}`;
  let response: Response;
  try {
    response = await fetch(jinaUrl, {
      method: "GET",
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "markdown",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs),
    });
  } catch (err: any) {
    throw new EvidenceFetchError(
      `Jina fallback failed: ${err?.message ?? "network error"}`,
    );
  }

  if (!response.ok) {
    throw new EvidenceFetchError(
      `Jina fallback failed (${response.status})`,
      response.status,
    );
  }

  const raw = await response.text();
  // Jina returns markdown; first non-empty heading line is a decent title.
  const title = extractJinaTitle(raw);
  const text = raw.replace(/\s+\n/g, "\n").trim().slice(0, args.maxChars);

  if (text.length < 200) {
    throw new EvidenceFetchError("Jina returned too little content to use");
  }

  return {
    sourceUrl: url.toString(),
    title,
    text,
    fetchedAt: Date.now(),
    fetcher: "jina",
  };
}

// ── CoinGecko handler ─────────────────────────────────────────────────────

const COINGECKO_COIN_PATH = /\/coins\/([^/?#]+)/i;

async function fetchCoinGeckoSnapshot(
  url: URL,
  opts: FetchEvidenceOptions,
): Promise<EvidenceSnapshot | null> {
  const match = url.pathname.match(COINGECKO_COIN_PATH);
  if (!match) return null;
  const coinId = decodeURIComponent(match[1]).toLowerCase().trim();
  if (!coinId || !/^[a-z0-9-]+$/.test(coinId)) return null;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const apiKey = process.env.COINGECKO_API_KEY?.trim();

  const params = new URLSearchParams({
    localization: "false",
    tickers: "false",
    market_data: "true",
    community_data: "false",
    developer_data: "false",
    sparkline: "false",
  });

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Mimir-Bot/1.0 (+https://mimir.app)",
  };
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

  let response: Response;
  try {
    response = await fetch(`${COINGECKO_API_BASE}/coins/${encodeURIComponent(coinId)}?${params}`, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null; // network error — let caller fall back to generic path
  }

  if (!response.ok) {
    // 404 = bad slug; 429 = rate-limited. Either way, fall back.
    return null;
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;
  const name = String(payload.name ?? coinId);
  const symbol = String(payload.symbol ?? "").toUpperCase();
  const md = payload.market_data;
  if (!md || typeof md !== "object") return null;

  const lines: string[] = [];
  lines.push(`CoinGecko snapshot — ${name}${symbol ? ` (${symbol})` : ""}`);
  lines.push(`Source: ${url.toString()}`);
  if (payload.last_updated) lines.push(`Last updated: ${payload.last_updated}`);
  lines.push("");

  const usd = (v: any) => (typeof v?.usd === "number" ? v.usd : null);
  const fields: Array<[string, number | null]> = [
    ["current_price_usd", usd(md.current_price)],
    ["market_cap_usd", usd(md.market_cap)],
    ["total_volume_24h_usd", usd(md.total_volume)],
    ["high_24h_usd", usd(md.high_24h)],
    ["low_24h_usd", usd(md.low_24h)],
    ["price_change_pct_24h", typeof md.price_change_percentage_24h === "number" ? md.price_change_percentage_24h : null],
    ["price_change_pct_7d", typeof md.price_change_percentage_7d === "number" ? md.price_change_percentage_7d : null],
    ["price_change_pct_30d", typeof md.price_change_percentage_30d === "number" ? md.price_change_percentage_30d : null],
    ["circulating_supply", typeof md.circulating_supply === "number" ? md.circulating_supply : null],
    ["total_supply", typeof md.total_supply === "number" ? md.total_supply : null],
    ["ath_usd", usd(md.ath)],
    ["atl_usd", usd(md.atl)],
  ];
  for (const [key, value] of fields) {
    if (value !== null) lines.push(`${key}: ${value}`);
  }

  if (typeof payload.market_cap_rank === "number") {
    lines.push(`market_cap_rank: ${payload.market_cap_rank}`);
  }

  const text = lines.join("\n").slice(0, opts.maxChars ?? DEFAULT_MAX_CHARS);

  return {
    sourceUrl: url.toString(),
    title: `${name}${symbol ? ` (${symbol})` : ""} — CoinGecko`,
    text,
    fetchedAt: Date.now(),
    fetcher: "coingecko-api",
  };
}

// ── Flash Trade handler ───────────────────────────────────────────────────

const FLASH_PRICES_PATH = /^\/prices\/([A-Z0-9]+)$/i;

async function fetchFlashTradeSnapshot(
  url: URL,
  opts: FetchEvidenceOptions,
): Promise<EvidenceSnapshot | null> {
  const match = url.pathname.match(FLASH_PRICES_PATH);
  if (!match) return null;
  const symbol = match[1].toUpperCase();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "Mimir-Bot/1.0 (+https://mimir.app)" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const priceUi = typeof payload.priceUi === "number" ? payload.priceUi : null;
  if (priceUi === null) return null;

  const fetchedAt = new Date().toISOString();
  const timestampUs = typeof payload.timestampUs === "number" ? payload.timestampUs : null;
  const priceTime = timestampUs ? new Date(timestampUs / 1000).toISOString() : fetchedAt;
  const marketSession = String(payload.marketSession ?? "unknown");
  const confidence = typeof payload.confidence === "number" ? payload.confidence : null;

  const lines = [
    `Flash Trade price snapshot — ${symbol}`,
    `Source: ${url.toString()}`,
    `Fetched at: ${fetchedAt}`,
    ``,
    `symbol: ${symbol}`,
    `current_price_usd: ${priceUi}`,
    `market_session: ${marketSession}`,
    `price_timestamp: ${priceTime}`,
  ];
  if (confidence !== null) lines.push(`confidence_units: ${confidence}`);
  if (typeof payload.price === "number" && typeof payload.exponent === "number") {
    lines.push(`raw_price_mantissa: ${payload.price}`);
    lines.push(`raw_price_exponent: ${payload.exponent}`);
    lines.push(`raw_price_formula: ${payload.price} × 10^${payload.exponent} = ${payload.price * Math.pow(10, payload.exponent)} USD`);
  }
  lines.push(``, `Note: priceUi is the human-readable USD price (e.g. current_price_usd: ${priceUi} means $${priceUi}).`);

  const text = lines.join("\n").slice(0, opts.maxChars ?? DEFAULT_MAX_CHARS);

  return {
    sourceUrl: url.toString(),
    title: `${symbol} — Flash Trade`,
    text,
    fetchedAt: Date.now(),
    fetcher: "flashtrade-api",
  };
}

// ── ESPN handler ──────────────────────────────────────────────────────────

async function fetchEspnSnapshot(
  url: URL,
  opts: FetchEvidenceOptions,
): Promise<EvidenceSnapshot | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "Mimir-Bot/1.0 (+https://mimir.app)" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const events: any[] = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) return null;

  const fetchedAt = new Date().toISOString();
  const lines: string[] = [
    `ESPN World Cup 2026 scoreboard`,
    `Source: ${url.toString()}`,
    `Fetched at: ${fetchedAt}`,
    `Total matches: ${events.length}`,
    ``,
  ];

  for (const event of events) {
    const competitions: any[] = Array.isArray(event.competitions) ? event.competitions : [];
    for (const comp of competitions) {
      const competitors: any[] = Array.isArray(comp.competitors) ? comp.competitors : [];
      if (competitors.length < 2) continue;
      const home = competitors.find((c: any) => c.homeAway === "home") ?? competitors[0];
      const away = competitors.find((c: any) => c.homeAway === "away") ?? competitors[1];
      const homeName = home.team?.displayName ?? home.team?.name ?? "Home";
      const awayName = away.team?.displayName ?? away.team?.name ?? "Away";
      const homeScore = home.score ?? "?";
      const awayScore = away.score ?? "?";
      const statusDesc = comp.status?.type?.description ?? event.status?.type?.description ?? "Unknown";
      const completed = comp.status?.type?.completed ?? false;
      const homeWon = home.winner === true;
      const awayWon = away.winner === true;
      const result = completed
        ? (homeWon ? `${homeName} wins` : awayWon ? `${awayName} wins` : "Draw")
        : "In progress / upcoming";

      lines.push(`Match: ${homeName} vs ${awayName}`);
      if (event.date) lines.push(`Date: ${event.date}`);
      lines.push(`Status: ${statusDesc}`);
      lines.push(`Score: ${homeName} ${homeScore} – ${awayScore} ${awayName}`);
      lines.push(`Result: ${result}`);
      lines.push(``);
    }
  }

  const text = lines.join("\n").slice(0, opts.maxChars ?? DEFAULT_MAX_CHARS);
  if (text.length < 200) return null;

  return {
    sourceUrl: url.toString(),
    title: "ESPN World Cup 2026 Scoreboard",
    text,
    fetchedAt: Date.now(),
    fetcher: "espn-api",
  };
}

// ── HTML helpers ──────────────────────────────────────────────────────────

function looksLikeCloudflareInterstitial(body: string): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  // Short HTML bodies that mention CF challenge markers are the giveaway —
  // a real article rarely has both a tiny body AND these strings.
  if (lower.length > 50_000) return false;
  return CLOUDFLARE_MARKERS.some((marker) => lower.includes(marker));
}

function decodeEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, value: string) => {
      const codePoint = Number(value);
      return Number.isFinite(codePoint) ? String.fromCharCode(codePoint) : "";
    });
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).trim() : "";
}

function extractJinaTitle(markdown: string): string {
  // Jina returns frontmatter-ish header lines: "Title: ...", "URL Source: ...".
  const titleLine = markdown.split("\n").find((line) => /^title:\s*/i.test(line));
  if (titleLine) return titleLine.replace(/^title:\s*/i, "").trim();
  const heading = markdown.split("\n").find((line) => /^#\s+/.test(line));
  return heading ? heading.replace(/^#\s+/, "").trim() : "";
}
