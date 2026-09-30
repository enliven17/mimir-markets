"use client";

import { buttonClass } from "@/components/ui/Button";
import ExploreEmptyStateShell from "./ExploreEmptyStateShell";

export type ExploreFilteredEmptyStateProps = {
  message: string;
  resetLabel: string;
  onReset: () => void;
};

/** Filters or search matched nothing: one line and a reset. */
export default function ExploreFilteredEmptyState({ message, resetLabel, onReset }: ExploreFilteredEmptyStateProps) {
  return (
    <ExploreEmptyStateShell
      action={
        <button type="button" onClick={onReset} className={buttonClass("light", "sm")}>
          {resetLabel}
        </button>
      }
    >
      {message}
    </ExploreEmptyStateShell>
  );
}
