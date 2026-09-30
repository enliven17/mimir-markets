"use client";

import type { ReactNode } from "react";
import { Link, useRouter } from "@/i18n/navigation";

export type SegmentedNavItem = { href: string; label: ReactNode };

/**
 * `Segmented` for sibling routes: the same pill track and sliding thumb, but
 * each segment is a link, the current one marked `aria-current="page"`.
 * The other segment is prefetched on hover, focus or touch, not when it
 * scrolls into view, so a page never downloads its sibling's code on load.
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
  const router = useRouter();
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
      {items.map((item, i) => {
        const warm = i === index ? undefined : () => router.prefetch(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={i === index ? "page" : undefined}
            onPointerEnter={warm}
            onFocus={warm}
            onTouchStart={warm}
          >
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
