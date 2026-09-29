"use client";

import { useEffect, useRef } from "react";
import { gsap, reducedMotion } from "@/lib/motion";

const defaultFormat = (n: number) => Math.round(n).toString();

/**
 * A number that rolls to its new value instead of snapping
 * (pandock/web/src/components/RollingNumber.tsx). `format` renders each
 * frame; keep it stable (module scope or useCallback) so a re-render does not
 * restart the tween. With `flash`, the value turns red on change and eases
 * back over 700ms (radio `.stat dd.flash`). Reduced motion: snaps, no flash.
 *
 * Renders in Geist Mono with tabular figures so ticking values never jiggle.
 */
export default function RollingNumber({
  value,
  format = defaultFormat,
  className = "",
  duration = 0.7,
  flash = false,
  mono = true,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
  flash?: boolean;
  mono?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef({ v: value });
  const first = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const isFirst = first.current;
    first.current = false;
    if (reducedMotion() || isFirst) {
      shown.current.v = value;
      el.textContent = format(value);
      return;
    }
    if (shown.current.v === value) return;
    let flashTimer: number | undefined;
    if (flash) {
      el.classList.add("is-flash");
      flashTimer = window.setTimeout(() => el.classList.remove("is-flash"), 120);
    }
    const tween = gsap.to(shown.current, {
      v: value,
      duration,
      ease: "expo.out",
      onUpdate: () => {
        el.textContent = format(shown.current.v);
      },
    });
    return () => {
      tween.kill();
      if (flashTimer) window.clearTimeout(flashTimer);
      el.classList.remove("is-flash");
    };
  }, [value, format, duration, flash]);

  return (
    <span
      ref={ref}
      className={`${mono ? "font-mono tabular-nums" : ""} ${flash ? "flashable" : ""} ${className}`}
    >
      {format(value)}
    </span>
  );
}
