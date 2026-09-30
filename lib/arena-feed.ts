/**
 * Pure selectors behind the arena feed (`/arena`): which claims sit under each
 * view, the shared filters (category, minimum creator stake, search, sort)
 * and the header totals. Everything reads the real `/api/arena/claims` rows.
 */
import { holdsStakes, isArchivedState, isLiveState } from "./claim-status";
import { unitsToUsdc } from "./money";

export type ArenaView = "open" | "live" | "resolved";
export type ArenaSort = "newest" | "pool";

export const ARENA_VIEWS: ArenaView[] = ["open", "live", "resolved"];
export const MIN_STAKE_PRESETS = [0, 5, 25, 100] as const;

/** The subset of the API claim the feed reads. */
export interface FeedClaim {
  id: number;
  question: string;
  category: string;
  creatorStake: string;
  totalChallengerStake: string;
  deadline: number;
  state: number;
  delegated: boolean;
}

export interface ArenaFilters {
  category: string;
  /** USDC, compared to the creator stake. 0 = any. */
  minStake: number;
  search: string;
  sort: ArenaSort;
}

export const DEFAULT_FILTERS: ArenaFilters = { category: "all", minStake: 0, search: "", sort: "newest" };

/** Pool in USDC: creator stake plus every challenger stake. */
export function poolOf(c: Pick<FeedClaim, "creatorStake" | "totalChallengerStake">): number {
  return unitsToUsdc(c.creatorStake) + unitsToUsdc(c.totalChallengerStake);
}

/** Open: live state and before the deadline. Live: the same, delegated to the ER. Settled: a verdict is in or cancelled. */
export function inView(c: FeedClaim, view: ArenaView, now: number): boolean {
  if (view === "resolved") return isArchivedState(c.state);
  const open = isLiveState(c.state) && c.deadline > now;
  return view === "live" ? open && c.delegated : open;
}

/** Filters that narrow the list (sort does not count). */
export function activeFilterCount(f: ArenaFilters): number {
  return (f.category !== "all" ? 1 : 0) + (f.minStake > 0 ? 1 : 0);
}

export function hasNarrowing(f: ArenaFilters): boolean {
  return activeFilterCount(f) > 0 || f.search.trim().length > 0;
}

export function applyFilters<T extends FeedClaim>(list: T[], f: ArenaFilters): T[] {
  const query = f.search.trim().toLowerCase();
  const out = list.filter(
    (c) =>
      (f.category === "all" || c.category === f.category) &&
      (f.minStake <= 0 || unitsToUsdc(c.creatorStake) >= f.minStake) &&
      (!query || c.question.toLowerCase().includes(query)),
  );
  return f.sort === "pool" ? out.sort((a, b) => poolOf(b) - poolOf(a)) : out.sort((a, b) => b.id - a.id);
}

export function viewClaims<T extends FeedClaim>(list: T[], view: ArenaView, f: ArenaFilters, now: number): T[] {
  return applyFilters(
    list.filter((c) => inView(c, view, now)),
    f,
  );
}

/** Categories present in the feed, sorted. */
export function feedCategories(list: FeedClaim[]): string[] {
  const seen = new Set<string>();
  for (const c of list) {
    const cat = (c.category ?? "").trim();
    if (cat) seen.add(cat);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/** Header line: claims open for a challenger right now and USDC still escrowed. */
export function feedTotals(list: FeedClaim[], now: number): { open: number; inPlay: number } {
  let open = 0;
  let inPlay = 0;
  for (const c of list) {
    if (inView(c, "open", now)) open += 1;
    if (holdsStakes(c.state)) inPlay += poolOf(c);
  }
  return { open, inPlay };
}

/** Parse a typed minimum stake ("12,5" works); junk or negatives mean "any". */
export function parseMinStake(raw: string): number {
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
