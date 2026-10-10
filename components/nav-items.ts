/**
 * Site navigation: the single source for the header pill, the "More" sheet,
 * the mobile panel and the footer.
 *
 * - `NAV_PRIMARY` sits in the pill: Arena, Portfolio, Agents, Council. Keep it at 4.
 * - `NAV_MORE_GROUPS` go into the "More" sheet (and the mobile panel and the
 *   footer). New pages usually belong here.
 *
 * Labels are next-intl keys under `nav.items.<key>` (`label`, `hint`) and
 * `nav.groups.<key>`.
 */
export interface NavItem {
  href: string;
  key: string;
  /** Also mark active on nested routes (e.g. /arena/42). */
  matchNested?: boolean;
  /** A small tag after the label, e.g. "beta". */
  badge?: string;
  /** Website only: hidden inside the installed app (html[data-app]), e.g. the page that offers the app. */
  webOnly?: boolean;
  /** Sibling tabs of the same page (e.g. /copy under Strategies): they light this entry too. */
  also?: readonly string[];
}

export interface NavGroup {
  key: string;
  items: readonly NavItem[];
}

export const NAV_PRIMARY: readonly NavItem[] = [
  { href: "/arena", key: "arena", matchNested: true },
  // Portfolio is the old Dashboard: label change only, the route stays. It also hosts the Arc account setup.
  { href: "/dashboard", key: "portfolio" },
  { href: "/agents", key: "agents" },
  { href: "/council", key: "council" },
];

/**
 * Grouped by what people come to do: explore, build on Mimir, and the rest.
 * One entry per page: tabs of the same page (Baskets/Copy, Stats/Calibration)
 * are listed once via `also`, and "New X" pages are a button on their list page. The desktop sheet hides anything already in the
 * pill (NAV_PRIMARY); the mobile sheet shows it, since the tab bar has no Agents.
 */
export const NAV_MORE_GROUPS: readonly NavGroup[] = [
  {
    key: "explore",
    items: [
      { href: "/baskets", key: "strategies", matchNested: true, also: ["/copy"] },
      { href: "/campaign", key: "campaign" },
      { href: "/stats", key: "stats", also: ["/calibration"] },
    ],
  },
  {
    key: "build",
    items: [
      { href: "/agents", key: "agents" },
      { href: "/agents/new", key: "agentsNew" },
      // The Mimir CLI (mimir-terminal on npm): /terminal is its install page.
      { href: "/terminal", key: "terminal" },
      { href: "/docs", key: "docs" },
    ],
  },
  {
    key: "mimir",
    items: [
      { href: "/app", key: "app", webOnly: true },
      { href: "/token", key: "token" },
      // The footer is hidden in the app, so the terms live here too.
      { href: "/terms", key: "terms" },
    ],
  },
];

/** The sheet's pages that are not already in the pill. */
export const NAV_MORE: readonly NavItem[] = NAV_MORE_GROUPS.flatMap((g) => g.items).filter((i) => !NAV_PRIMARY.some((p) => p.href === i.href));

/** Primary call to action: the coral pill next to the links. */
export const NAV_CTA: NavItem = { href: "/arena/create", key: "create" };

/** Every nav entry, primary first. */
export const NAV_ITEMS: readonly NavItem[] = [...NAV_PRIMARY, ...NAV_MORE, NAV_CTA];

function matches(pathname: string, item: NavItem): boolean {
  if (pathname === item.href || item.also?.includes(pathname)) return true;
  return Boolean(item.matchNested && pathname.startsWith(item.href + "/"));
}

/**
 * The one nav entry that owns `pathname`: an exact match wins, then the
 * longest nested match, so /baskets/new lights "New basket", not "Baskets",
 * and /arena/create lights the CTA, not "Arena".
 */
export function activeNavHref(pathname: string): string | null {
  let best: NavItem | null = null;
  for (const item of NAV_ITEMS) {
    if (!matches(pathname, item)) continue;
    if (pathname === item.href || item.also?.includes(pathname)) return item.href;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best?.href ?? null;
}

export function isNavActive(pathname: string, item: NavItem): boolean {
  return activeNavHref(pathname) === item.href;
}
