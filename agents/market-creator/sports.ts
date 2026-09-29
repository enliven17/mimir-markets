/**
 * Sports claims from ESPN's public scoreboards (World Cup, Premier League,
 * Champions League, NFL, NBA; keyless JSON).
 *
 * Only scheduled, not-started games inside the horizon are drafted: a live
 * game makes the deadline uncertain and a finished one resolves on sight.
 * The deadline is pinned to KICKOFF, not after the match: the program uses one
 * deadline for both the betting cutoff and settlement, so betting open past
 * kickoff would let anyone bet on a known result. The oracle then waits for a
 * final result (category "sports", agents/oracle/decide.ts).
 *
 * The resolution URL is that day's scoreboard with `event=<id>`: ESPN ignores
 * the extra parameter and the oracle's ESPN evidence handler narrows the
 * snapshot to that one match.
 */
import { clampBytes, formatDay, MAX_POSITION_BYTES, toDeadline, type DraftClaim } from "./draft";

export interface SportsLeague {
  /** ESPN path under /apis/site/v2/sports/. */
  path: string;
  name: string;
  /** Soccer can draw, so "No" covers the draw as well. */
  canDraw: boolean;
}

export const SPORTS_LEAGUES: SportsLeague[] = [
  { path: "soccer/fifa.world", name: "World Cup", canDraw: true },
  { path: "soccer/eng.1", name: "Premier League", canDraw: true },
  { path: "soccer/uefa.champions", name: "Champions League", canDraw: true },
  { path: "football/nfl", name: "NFL", canDraw: false },
  { path: "basketball/nba", name: "NBA", canDraw: false },
];

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
/** Kickoff this close can't draw challengers before betting closes. */
export const MIN_HOURS_TO_KICKOFF = 2;

export interface SportsGame {
  id: string;
  league: SportsLeague;
  home: string;
  away: string;
  /** ms epoch */
  startMs: number;
}

function yyyymmdd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

export function gameResolutionUrl(g: SportsGame): string {
  return `${ESPN_BASE}/${g.league.path}/scoreboard?dates=${yyyymmdd(g.startMs)}&event=${encodeURIComponent(g.id)}`;
}

/** Scheduled games out of one scoreboard payload, inside [now+2h, now+maxHours]. */
export function parseScoreboard(payload: any, league: SportsLeague, now: number, maxHours: number): SportsGame[] {
  const events: any[] = Array.isArray(payload?.events) ? payload.events : [];
  const out: SportsGame[] = [];
  for (const e of events) {
    if (e?.status?.type?.state !== "pre" || e?.status?.type?.completed) continue;
    const startMs = Date.parse(String(e?.date ?? ""));
    if (!Number.isFinite(startMs)) continue;
    const hours = (startMs - now) / 3_600_000;
    if (hours < MIN_HOURS_TO_KICKOFF || hours > maxHours) continue;
    const comp = Array.isArray(e.competitions) ? e.competitions[0] : null;
    const competitors: any[] = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const home = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
    const away = competitors.find((c) => c.homeAway === "away") ?? competitors[1];
    const homeName = String(home?.team?.displayName ?? "").trim();
    const awayName = String(away?.team?.displayName ?? "").trim();
    if (!e.id || !homeName || !awayName || homeName === awayName) continue;
    out.push({ id: String(e.id), league, home: homeName, away: awayName, startMs });
  }
  return out;
}

export function sportsDraft(g: SportsGame): DraftClaim {
  const day = formatDay(g.startMs);
  const question = `Will ${g.home} beat ${g.away} in their ${g.league.name} game on ${day}?`;
  const counter = g.league.canDraw ? `No — draw or ${g.away} win` : `No — ${g.away} win`;
  return {
    question,
    creatorPosition: clampBytes(`Yes — ${g.home} win`, MAX_POSITION_BYTES),
    counterPosition: clampBytes(counter, MAX_POSITION_BYTES),
    category: "sports",
    resolutionUrl: gameResolutionUrl(g),
    settlementRule:
      `Resolve from the final score on the linked ESPN scoreboard for this game (event ${g.id}): ` +
      `Side A wins if ${g.home} is listed as the winner once the game is final${g.league.canDraw ? "; a draw goes to Side B" : ""}. ` +
      `Betting closes at kickoff, ${new Date(g.startMs).toISOString()} UTC.`,
    deadline: toDeadline(g.startMs),
    source: "espn",
    label: `${g.league.name}: ${g.home} vs ${g.away}`,
  };
}

async function fetchLeague(league: SportsLeague, now: number, maxHours: number): Promise<SportsGame[]> {
  try {
    const res = await fetch(`${ESPN_BASE}/${league.path}/scoreboard`, {
      headers: { accept: "application/json", "User-Agent": "Mimir-MarketCreator/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    return parseScoreboard(await res.json(), league, now, maxHours);
  } catch (err) {
    console.warn(`[creator] ESPN ${league.name} fetch failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Up to `count` upcoming games, soonest first, one per league before a second
 * from any league, so an NFL Sunday doesn't crowd out everything else.
 */
export async function draftSportsClaims(count: number, maxHours: number, now = Date.now()): Promise<DraftClaim[]> {
  if (count <= 0) return [];
  const perLeague = await Promise.all(SPORTS_LEAGUES.map((l) => fetchLeague(l, now, maxHours)));
  const queues = perLeague.map((games) => [...games].sort((a, b) => a.startMs - b.startMs));
  const picked: SportsGame[] = [];
  while (picked.length < count && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const g = q.shift();
      if (g && picked.length < count) picked.push(g);
    }
  }
  return picked.map(sportsDraft);
}
