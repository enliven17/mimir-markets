"use client";

import type { RefObject } from "react";
import { gsap, MOTION_OK_QUERY, ScrollTrigger, useGSAP } from "@/lib/motion";

/**
 * `[data-rise]` batch: every marked
 * element inside `scope` rises in once when it scrolls into view, batched so
 * neighbours stagger. Only inside `gsap.matchMedia(no-preference)`, so it
 * reverts on its own when reduced motion is switched on.
 *
 * With JS and motion allowed, globals.css hides `[data-rise]` before paint
 * (no flash of content that then vanishes and rises). The tween marks each
 * element `data-risen` and fades it in. Failsafe: the `motion-timeout` class
 * the head script adds after 3s shows anything that never got a batch (added
 * late, inside a hidden tab). Without JS or with reduced motion nothing is
 * hidden. Pass `deps` (e.g. a data length) to pick up elements rendered later.
 */
export function useRiseBatch(
  scope: RefObject<HTMLElement | null>,
  {
    deps = [],
    y = 48,
    duration = 1.1,
    stagger = 0.1,
    start = "top 88%",
  }: { deps?: unknown[]; y?: number; duration?: number; stagger?: number; start?: string } = {},
) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK_QUERY, () => {
        const root = scope.current;
        if (!root) return;
        const els = Array.from(root.querySelectorAll<HTMLElement>("[data-rise]:not([data-risen])"));
        if (els.length === 0) return;
        ScrollTrigger.batch(els, {
          start,
          once: true,
          onEnter: (batch) => {
            gsap.fromTo(
              batch,
              { y, opacity: 0 },
              {
                y: 0,
                opacity: 1,
                duration,
                ease: "expo.out",
                stagger,
                clearProps: "transform,opacity",
                onStart: () => batch.forEach((el) => el.setAttribute("data-risen", "")),
              },
            );
          },
        });
      });
      return () => {
        mm.revert();
      };
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  );
}

export default useRiseBatch;
