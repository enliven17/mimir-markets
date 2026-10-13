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

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Does `name` (from the question) name this ESPN team? Either contains the other, as whole words. */
function names(name: string, team: string): boolean {
  const a = ` ${norm(name)} `, b = ` ${norm(team)} `;
  return a.trim().length > 2 && (b.includes(a) || a.includes(b));
}

/**
 * For "Will X beat Y …?" on a finished ESPN game: true if X won, false if X lost or drew, null when the question is
 * not of that form, a name does not match exactly one ESPN team, or the game is not over. The oracle then settles a
 * Yes/No market from the score without a model (agents/oracle/decide.ts).
 */
export function espnBeatCondition(question: string, r: EspnResult): boolean | null {
  if (!r.completed || r.teams.length !== 2) return null;
  const m = /^\s*will\s+(?:the\s+)?(.+?)\s+beat\s+(?:the\s+)?(.+?)(?:\s+(?:in|on|at|this|tonight|today)\b.*|\?)\s*$/i.exec(question);
  if (!m) return null;
  const x = r.teams.filter((t) => names(m[1], t.name));
  const y = r.teams.filter((t) => names(m[2], t.name));
  if (x.length !== 1 || y.length !== 1 || x[0] === y[0]) return null;
  if (r.teams.some((t) => t.winner)) return x[0].winner;
  // No winner flagged: a draw only when both scores are there and equal; anything else is not for us to guess.
  const [s1, s2] = r.teams.map((t) => t.score);
  return s1 !== null && s2 !== null && s1 === s2 ? false : null;
}
