"use client";

/**
 * The "!" beside a market's state: hover, focus or tap it for the caution that any market can be set up badly.
 * CSS only (group-hover / focus-within), so it works with a mouse, a keyboard and a tap.
 */
import { useId } from "react";

export default function MarketCaution() {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-describedby={id}
        aria-label="Before you stake"
        className="grid h-[18px] w-[18px] place-items-center rounded-full bg-coral/15 text-[11px] font-bold text-coral outline-none ring-coral/60 hover:bg-coral/25 focus-visible:ring-2"
      >
        !
      </button>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none invisible absolute right-0 top-[calc(100%+8px)] z-30 w-[min(300px,80vw)] rounded-xl bg-panel-raised p-3 text-left text-[12.5px] normal-case leading-relaxed tracking-normal text-muted opacity-0 shadow-[0_12px_32px_rgb(0_0_0/.45),inset_0_0_0_1px_rgb(255_81_72/.35)] transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <strong className="mb-1 block text-[13px] font-medium text-cream">Read this market before you stake</strong>
        Anyone can open a market. Check the question, the deadline and the resolution source. A market whose deadline let
        people stake after the result was known is refunded, and AI verdicts can be disputed for 24 hours.
      </span>
    </span>
  );
}
