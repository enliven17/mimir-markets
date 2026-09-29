"use client";

import { useRef, type ReactNode } from "react";

/**
 * Horizontal snap list: columns of
 * `min(380px, 84vw)`, hidden scrollbar, optional 44px round glass prev/next
 * buttons that scroll by one card.
 */
export default function Rail({
  children,
  label,
  prevLabel = "Previous",
  nextLabel = "Next",
  controls = true,
  className = "",
}: {
  children: ReactNode;
  label: string;
  prevLabel?: string;
  nextLabel?: string;
  controls?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const step = card ? card.getBoundingClientRect().width + 16 : el.clientWidth * 0.8;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * step, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className={className}>
      {controls ? (
        <div className="mb-4 flex justify-end gap-2">
          {([-1, 1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => scrollBy(dir)}
              aria-label={dir < 0 ? prevLabel : nextLabel}
              className="glass press grid h-11 w-11 place-items-center rounded-full text-cream shadow-chip transition-colors hover:bg-[rgba(34,20,22,.78)]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" shapeRendering="crispEdges" fill="currentColor" aria-hidden>
                {dir < 0 ? (
                  <path d="M6 1h2v2H6v2H4v2h2v2h2v2H6V9H4V7H2V5h2V3h2z" />
                ) : (
                  <path d="M4 1h2v2h2v2h2v2H8v2H6v2H4V9h2V7h2V5H6V3H4z" />
                )}
              </svg>
            </button>
          ))}
        </div>
      ) : null}
      <div ref={ref} role="region" aria-label={label} className="rail pb-[18px] pt-1" data-lenis-prevent-horizontal>
        {children}
      </div>
    </div>
  );
}
