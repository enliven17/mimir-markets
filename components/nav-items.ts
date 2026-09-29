/**
 * Header navigation — single source for the desktop row and the mobile sheet.
 * Later phases append entries here (verify, calibration, council, …); the
 * header shows the full row from `xl` up and a menu below that, so the list
 * can grow without overflowing tablets.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Also mark active on nested routes (e.g. /arena/42). */
  matchNested?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/arena", label: "Arena", matchNested: true },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/stats", label: "Stats" },
  { href: "/calibration", label: "Calibration" },
  { href: "/agents", label: "Agents" },
  { href: "/baskets", label: "Baskets", matchNested: true },
  { href: "/copy", label: "Copy" },
  { href: "/agents/new", label: "Connect agent" },
  { href: "/docs", label: "Docs" },
];

/** Primary call to action shown as a filled chip next to the nav. */
export const NAV_CTA = { href: "/arena/create", label: "Publish", mobileLabel: "Publish a challenge" };

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  if (!item.matchNested || !pathname.startsWith(item.href + "/")) return false;
  // The CTA route has its own chip — don't double-highlight it.
  return pathname !== NAV_CTA.href;
}
