"use client";

import { useRef, type ReactNode } from "react";
import { getLenis, gsap, reducedMotion, useGSAP } from "@/lib/motion";

/**
 * Scroll ticker: the content is
 * rendered twice and slides on GSAP's ticker; Lenis scroll velocity speeds it
 * up and flips it with the scroll direction. Pauses while hovered.
 * Reduced motion: a static row, the duplicate is not rendered.
 *
 * Decorative by default (`aria-hidden`); pass `label` to expose it.
 */
export default function Marquee({
  children,
  speed = 60,
  className = "",
  label,
}: {
  children: ReactNode;
  /** Pixels per second at rest. */
  speed?: number;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root || reducedMotion()) return;
      const track = root.firstElementChild as HTMLElement | null;
      if (!track) return;
      track.dataset.loop = "true";
      let x = 0;
      let dir = 1;
      let paused = false;
      const half = () => track.scrollWidth / 2;
      const tick = (_time: number, dt: number) => {
        if (paused) return;
        const v = getLenis()?.velocity ?? 0;
        if (Math.abs(v) > 0.5) dir = v > 0 ? 1 : -1;
        x -= (speed * dt * dir * (1 + Math.min(Math.abs(v) / 8, 4))) / 1000;
        const w = half();
        if (w > 0) {
          if (x <= -w) x += w;
          if (x > 0) x -= w;
        }
        gsap.set(track, { x });
      };
      const pause = () => (paused = true);
      const resume = () => (paused = false);
      root.addEventListener("pointerenter", pause);
      root.addEventListener("pointerleave", resume);
      gsap.ticker.add(tick);
      return () => {
        gsap.ticker.remove(tick);
        root.removeEventListener("pointerenter", pause);
        root.removeEventListener("pointerleave", resume);
      };
    },
    { scope: ref, dependencies: [speed] },
  );

  return (
    <div
      ref={ref}
      className={`marquee ${className}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "marquee" : undefined}
    >
      <div className="marquee-track">
        <div className="flex">{children}</div>
        <div className="flex motion-reduce:hidden" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
