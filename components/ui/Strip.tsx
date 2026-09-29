import type { ReactNode } from "react";

/**
 * KPI row: full-bleed grid split by hairlines on a
 * translucent band; each cell a `dt` micro label over a `dd` value. Pair the
 * value with `RollingNumber flash` so it turns red on change.
 */
export function Strip({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <dl className={`strip ${className}`} aria-label={label}>
      {children}
    </dl>
  );
}

export function StripCell({
  label,
  value,
  live = false,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  /** Adds a blinking pixel dot after the label. */
  live?: boolean;
  className?: string;
}) {
  return (
    <div className={`strip-cell ${className}`}>
      <dt className="flex items-center gap-1.5">
        {label}
        {live ? <span className="px-dot !h-1.5 !w-1.5" aria-hidden /> : null}
      </dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}

export default Strip;
