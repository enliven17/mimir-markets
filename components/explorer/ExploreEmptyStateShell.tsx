"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui";

export type ExploreEmptyStateShellProps = {
  /** One line. */
  children: ReactNode;
  /** At most one action. */
  action?: ReactNode;
  /** Announces updates to assistive tech (the list just emptied). */
  announce?: boolean;
};

/** Shared dashed empty box for the arena feed: one line, one action. */
export default function ExploreEmptyStateShell({ children, action, announce = true }: ExploreEmptyStateShellProps) {
  return (
    <div {...(announce ? { role: "status" as const, "aria-live": "polite" as const } : {})} className="fade-rise py-10 sm:py-14">
      <EmptyState action={action}>{children}</EmptyState>
    </div>
  );
}
