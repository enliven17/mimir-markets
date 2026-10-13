/**
 * ESPN as structured data for the oracle: any ESPN game link (a site.api scoreboard/summary query with event=, or a
 * www.espn.com match/game page) maps to the event's summary JSON, which says whether the game is over, the score,
 * the winner and when it started. The oracle then knows "is it final?" and "when was it known?" without a model call
 * (agents/oracle/decide.ts, convex/arcOracle.ts), and the model that writes the verdict gets the final score.
 */

/** www.espn.com path segment → the site.api sport/league path that serves its summaries. */
const WEB_SPORT: Record<string, string> = {
  soccer: "soccer/all",
  nfl: "football/nfl",
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
  "college-football": "football/college-football",
  "mens-college-basketball": "basketball/mens-college-basketball",
};

/** The summary JSON URL for an ESPN game link, or null when the link is not one. */
export function espnSummaryUrl(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === "site.api.espn.com") {
    const m = /^\/apis\/site\/v2\/sports\/([a-z-]+)\/([a-z0-9.-]+)\/(?:scoreboard|summary)\/?$/i.exec(u.pathname);
    const event = u.searchParams.get("event");
    if (!m || !event || !/^\d{4,12}$/.test(event)) return null;
    return `https://site.api.espn.com/apis/site/v2/sports/${m[1]}/${m[2]}/summary?event=${event}`;
  }
  if (host === "www.espn.com" || host === "espn.com") {
    const m = /^\/([a-z-]+)\/(?:match|game)\/_\/gameId\/(\d{4,12})(?:\/|$)/i.exec(u.pathname);
    const sport = m ? WEB_SPORT[m[1].toLowerCase()] : undefined;
    if (!m || !sport) return null;
    return `https://site.api.espn.com/apis/site/v2/sports/${sport}/summary?event=${m[2]}`;
  }
  return null;
}

export interface EspnResult {
  completed: boolean;
  /** ESPN's status text: "Final", "Scheduled", "Halftime", "Postponed"… */
  status: string;
  /** Kickoff, unix seconds (NaN when ESPN gives none). */
  startAt: number;
  teams: Array<{ name: string; score: string | null; winner: boolean }>;
}

/** The parts of a summary payload the oracle reads; null when it is not one. */
export function parseEspnSummary(body: unknown): EspnResult | null {
  const comp = (body as { header?: { competitions?: Array<Record<string, unknown>> } } | null)?.header?.competitions?.[0];
  if (!comp) return null;
  const type = (comp.status as { type?: { completed?: unknown; description?: unknown } } | undefined)?.type;
  const teams = ((comp.competitors as Array<Record<string, unknown>> | undefined) ?? []).map((c) => ({
    name: String((c.team as { displayName?: unknown } | undefined)?.displayName ?? "?"),
    score: c.score === undefined || c.score === null ? null : String(c.score),
    winner: c.winner === true,
  }));
  if (!type || teams.length < 2) return null;
  return { completed: type.completed === true, status: String(type.description ?? ""), startAt: Math.floor(Date.parse(String(comp.date ?? "")) / 1000), teams };
}

/** The result for an ESPN game link; null when the link is not ESPN's or ESPN cannot be read (the caller falls back). */
export async function espnResult(link: string): Promise<EspnResult | null> {
  const url = espnSummaryUrl(link);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? parseEspnSummary(await res.json()) : null;
  } catch {
    return null;
  }
}

/** One line for the verdict model's evidence. */
export function espnResultText(r: EspnResult): string {
  const score = r.teams.map((t) => `${t.name} ${t.score ?? "-"}`).join(", ");
  const winner = r.teams.find((t) => t.winner)?.name;
  const started = Number.isFinite(r.startAt) ? new Date(r.startAt * 1000).toISOString() : "unknown";
  return `ESPN structured result (authoritative): status ${r.status}${r.completed ? " (completed)" : ""}. ${score}.${winner ? ` Winner: ${winner}.` : r.completed ? " No winner (a draw)." : ""} Started ${started}.`;
}
