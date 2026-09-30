"use client";

import { useRef, type ReactNode } from "react";
import { getLenis, gsap, reducedMotion, useGSAP } from "@/lib/motion";

/**
 * Scroll ticker: the content is
 * rendered twice and slides on GSAP's ticker; Lenis scroll velocity speeds it
 * up and flips it with the scroll direction. Pauses while hovered and while
 * offscreen; per frame it only writes a transform (no layout reads).
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
      let hovered = false;
      let onScreen = true;
      // The loop width is measured by a ResizeObserver, never read per frame:
      // a scrollWidth read after the last frame's transform write forced a
      // synchronous layout on every tick (the landing's biggest scroll cost).
      let half = track.scrollWidth / 2;
      const ro = new ResizeObserver(() => {
        half = track.scrollWidth / 2;
      });
      ro.observe(track);
      const set = gsap.quickSetter(track, "x", "px");
      const tick = (_time: number, dt: number) => {
        if (hovered || !onScreen) return;
        const v = getLenis()?.velocity ?? 0;
        if (Math.abs(v) > 0.5) dir = v > 0 ? 1 : -1;
        x -= (speed * dt * dir * (1 + Math.min(Math.abs(v) / 8, 4))) / 1000;
        if (half > 0) {
          if (x <= -half) x += half;
          if (x > 0) x -= half;
        }
        set(x);
      };
      // Offscreen, the tick returns at once.
      const io = new IntersectionObserver(([entry]) => {
        onScreen = entry?.isIntersecting ?? true;
      });
      io.observe(root);
      const pause = () => (hovered = true);
      const resume = () => (hovered = false);
      root.addEventListener("pointerenter", pause);
      root.addEventListener("pointerleave", resume);
      gsap.ticker.add(tick);
      return () => {
        gsap.ticker.remove(tick);
        ro.disconnect();
        io.disconnect();
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
