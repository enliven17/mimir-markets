/**
 * Site navigation: the single source for the header pill, the "More" sheet,
 * the mobile panel and the footer.
 *
 * - `NAV_PRIMARY` sits in the pill: Terminal (beta), Arena, Council, Portfolio. Keep it at 4.
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
}

export interface NavGroup {
  key: string;
  items: readonly NavItem[];
}

export const NAV_PRIMARY: readonly NavItem[] = [
  { href: "/terminal", key: "terminal", badge: "beta" },
  { href: "/arena", key: "arena", matchNested: true },
  { href: "/council", key: "council" },
  // Portfolio is the old Dashboard: label change only, the route stays.
  { href: "/dashboard", key: "portfolio" },
];

export const NAV_MORE_GROUPS: readonly NavGroup[] = [
  {
    key: "agents",
    items: [
      { href: "/agents", key: "agents" },
      { href: "/agents/new", key: "agentsNew" },
    ],
  },
  {
    key: "strategies",
    items: [
      { href: "/baskets", key: "baskets", matchNested: true },
      { href: "/baskets/new", key: "basketsNew" },
      { href: "/copy", key: "copy" },
    ],
  },
  { key: "wallet", items: [{ href: "/wallet", key: "wallet", badge: "beta" }] },
  { key: "token", items: [{ href: "/token", key: "token" }] },
  {
    key: "data",
    items: [
      { href: "/campaign", key: "campaign", badge: "new" },
      { href: "/stats", key: "stats" },
      { href: "/calibration", key: "calibration" },
    ],
  },
  { key: "docs", items: [{ href: "/docs", key: "docs" }] },
];

export const NAV_MORE: readonly NavItem[] = NAV_MORE_GROUPS.flatMap((g) => g.items);

/** Primary call to action: the coral pill next to the links. */
export const NAV_CTA: NavItem = { href: "/arena/create", key: "create" };

/** Every nav entry, primary first. */
export const NAV_ITEMS: readonly NavItem[] = [...NAV_PRIMARY, ...NAV_MORE, NAV_CTA];

function matches(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
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
    if (pathname === item.href) return item.href;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best?.href ?? null;
}

export function isNavActive(pathname: string, item: NavItem): boolean {
  return activeNavHref(pathname) === item.href;
}
