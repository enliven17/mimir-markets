"use client";

import type { RefObject } from "react";
import { gsap, MOTION_OK_QUERY, ScrollTrigger, useGSAP } from "@/lib/motion";

/**
 * `[data-rise]` batch (pandock/web/src/Landing.tsx:32-39): every marked
 * element inside `scope` rises in once when it scrolls into view, batched so
 * neighbours stagger. Only inside `gsap.matchMedia(no-preference)`, so it
 * reverts on its own when reduced motion is switched on.
 *
 * Elements are visible in the SSR HTML and only hidden by the tween itself,
 * so nothing stays invisible if an element is added after the batch ran.
 * Pass `deps` (e.g. a data length) to pick up elements rendered later.
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
            batch.forEach((el) => el.setAttribute("data-risen", ""));
            gsap.from(batch, {
              y,
              opacity: 0,
              duration,
              ease: "expo.out",
              stagger,
              clearProps: "transform,opacity",
            });
          },
        });
      });
      return () => mm.revert();
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  );
}

export default useRiseBatch;
