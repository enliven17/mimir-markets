/**
 * Header navigation — single source for the desktop row, the "More" menu,
 * the mobile sheet and the footer.
 *
 * - `NAV_PRIMARY` sits in the desktop row. Keep it to ~5 entries.
 * - `NAV_MORE_GROUPS` go into the "More" menu on desktop and are listed as
 *   their own groups in the mobile sheet. New pages usually belong here.
 */
export interface NavItem {
  href: string;
  label: string;
  /** One-line hint shown in the "More" menu. */
  hint?: string;
  /** Also mark active on nested routes (e.g. /arena/42). */
  matchNested?: boolean;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

export const NAV_PRIMARY: readonly NavItem[] = [
  { href: "/arena", label: "Arena", matchNested: true },
  { href: "/council", label: "Council" },
  { href: "/agents", label: "Agents" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/token", label: "Token" },
];

export const NAV_MORE_GROUPS: readonly NavGroup[] = [
  {
    label: "Analytics",
    items: [
      { href: "/stats", label: "Stats", hint: "Markets, volume and settlements" },
      { href: "/calibration", label: "Calibration", hint: "How well the oracle's confidence holds up" },
    ],
  },
  {
    label: "Strategies",
    items: [
      { href: "/baskets", label: "Baskets", hint: "Bundles of claims to follow", matchNested: true },
      { href: "/copy", label: "Copy", hint: "Mirror another wallet's positions" },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/agents/new", label: "Connect agent", hint: "Register an AI agent that trades" },
      { href: "/docs", label: "Docs", hint: "How claims are settled on-chain" },
    ],
  },
];

export const NAV_MORE: readonly NavItem[] = NAV_MORE_GROUPS.flatMap((g) => g.items);

/** Every nav entry, primary first. */
export const NAV_ITEMS: readonly NavItem[] = [...NAV_PRIMARY, ...NAV_MORE];

/** Groups for the mobile sheet: primary links first, then the "More" groups. */
export const NAV_SHEET_GROUPS: readonly NavGroup[] = [
  { label: "Explore", items: NAV_PRIMARY },
  ...NAV_MORE_GROUPS,
];

/** Primary call to action shown as a filled chip next to the nav. */
export const NAV_CTA = { href: "/arena/create", label: "Publish", mobileLabel: "Publish a challenge" };

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  if (!item.matchNested || !pathname.startsWith(item.href + "/")) return false;
  // The CTA route has its own chip — don't double-highlight it.
  return pathname !== NAV_CTA.href;
}
