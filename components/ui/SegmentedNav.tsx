import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

export type SegmentedNavItem = { href: string; label: ReactNode };

/**
 * `Segmented` for sibling routes: the same pill track and sliding thumb, but
 * each segment is a link, the current one marked `aria-current="page"`.
 * Server-renderable; the thumb position comes from the index alone.
 */
export default function SegmentedNav({
  items,
  current,
  label,
  className = "",
}: {
  items: SegmentedNavItem[];
  /** href of the current route. */
  current: string;
  /** Accessible name for the nav. */
  label: string;
  className?: string;
}) {
  const index = Math.max(
    0,
    items.findIndex((i) => i.href === current),
  );
  return (
    <nav
      aria-label={label}
      data-tone="maroon"
      className={`segmented ${className}`}
      style={{ "--n": items.length, "--i": index } as React.CSSProperties}
    >
      {items.map((item, i) => (
        <Link key={item.href} href={item.href} aria-current={i === index ? "page" : undefined}>
          <span className="truncate">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
