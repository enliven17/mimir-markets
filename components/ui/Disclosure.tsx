import type { ReactNode } from "react";

/**
 * Progressive disclosure on a native `<details>` (radio
 * `.stream-transport-proof`): glass, `rounded-lg`, summary with a coral
 * chevron that turns 180deg, body split from the summary by a hairline.
 * Keyboard and screen-reader support come from the element itself.
 */
export default function Disclosure({
  summary,
  meta,
  children,
  defaultOpen = false,
  className = "",
  id,
}: {
  summary: ReactNode;
  /** Right-aligned text before the chevron (a count, a total). */
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <details id={id} className={`disclosure ${className}`} open={defaultOpen || undefined}>
      <summary className="min-h-[28px] rounded-xs">
        <span className="min-w-0 truncate">{summary}</span>
        <span className="ml-auto flex items-center gap-3">
          {meta ? <span className="text-muted">{meta}</span> : null}
          <span className="disclosure-chevron" aria-hidden>
            <svg width="10" height="10" viewBox="0 0 10 10" shapeRendering="crispEdges" fill="currentColor">
              <path d="M0 2h2v2h2v2h2V4h2V2h2v2H8v2H6v2H4V6H2V4H0z" />
            </svg>
          </span>
        </span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
