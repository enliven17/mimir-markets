"use client";

import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui";
import ExploreEmptyStateShell from "./ExploreEmptyStateShell";

export type ExploreArenaEmptyStateProps = {
  message: string;
  ctaLabel: string;
  /** Locale-aware route (e.g. `/arena/create`). */
  ctaHref: string;
};

/** A feed view with nothing in it (no filters active): one line and a link onward. */
export default function ExploreArenaEmptyState({ message, ctaLabel, ctaHref }: ExploreArenaEmptyStateProps) {
  return (
    <ExploreEmptyStateShell
      action={
        <Link href={ctaHref} className={buttonClass("light", "sm")}>
          {ctaLabel}
        </Link>
      }
    >
      {message}
    </ExploreEmptyStateShell>
  );
}
