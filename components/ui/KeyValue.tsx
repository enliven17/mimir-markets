import { Fragment, type ReactNode } from "react";

export type KeyValueRow = {
  label: ReactNode;
  value: ReactNode;
  /** Render the value in the pixel face instead of Geist Mono. */
  plain?: boolean;
};

/**
 * Two-column `dl` in a faint well (radio `.insp-rows`): `dt` dim 13px,
 * `dd` mono 13px right-aligned with tabular figures.
 */
export default function KeyValue({ rows, className = "" }: { rows: KeyValueRow[]; className?: string }) {
  return (
    <dl className={`kv ${className}`}>
      {rows.map((r, i) => (
        <Fragment key={i}>
          <dt>{r.label}</dt>
          <dd className={r.plain ? "!font-pixel" : ""}>{r.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
