"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Small numeral after the label (tab counts). */
  count?: number;
};

/**
 * Pill track with a sliding thumb.
 * `tone="cream"` = cream thumb + ink label (landing),
 * `tone="maroon"` = maroon gradient thumb + cream label (app).
 *
 * `role="tablist"` when it switches views (tabs), otherwise a group of
 * toggle buttons. Arrow keys move the selection.
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  tone = "cream",
  as = "tabs",
  className = "",
  size = "md",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the control. */
  label: string;
  tone?: "cream" | "maroon";
  as?: "tabs" | "toggle";
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (index + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const isTabs = as === "tabs";

  return (
    <div
      role={isTabs ? "tablist" : "group"}
      aria-label={label}
      data-tone={tone}
      onKeyDown={onKeyDown}
      className={`segmented ${size === "sm" ? "[&>button]:!min-h-[34px] [&>button]:!text-[13px]" : ""} ${className}`}
      style={{ "--n": options.length, "--i": index } as React.CSSProperties}
    >
      {options.map((o, i) => {
        const selected = i === index;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            id={`${id}-${o.value}`}
            role={isTabs ? "tab" : undefined}
            aria-selected={isTabs ? selected : undefined}
            aria-pressed={isTabs ? undefined : selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
          >
            <span className="truncate">{o.label}</span>
            {o.count !== undefined ? (
              <span className="font-mono text-[11px] tabular-nums opacity-70">{o.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
