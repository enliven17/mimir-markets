"use client";

import { useRef, type ReactNode } from "react";
import { gsap, reducedMotion, SplitText, useGSAP } from "@/lib/motion";

/**
 * Masked line reveal (pandock/web/src/components/SplitReveal.tsx). Splits the
 * first child into lines once fonts are ready, then slides each line up from
 * behind its mask. Reverts the split on unmount. Reduced motion: static text.
 *
 * The SSR HTML is plain text, so the heading is readable and counts for LCP;
 * the wrapper only hides itself for the frame between split and tween.
 */
export default function SplitReveal({
  children,
  scroll = true,
  delay = 0,
  start = "top 85%",
  className,
}: {
  children: ReactNode;
  /** Play when scrolled into view (default) or right away. */
  scroll?: boolean;
  delay?: number;
  start?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || reducedMotion()) return;
      const target = el.firstElementChild as HTMLElement | null;
      if (!target) return;

      let split: SplitText | undefined;
      let cancelled = false;
      const build = () => {
        split = SplitText.create(target, {
          type: "lines",
          mask: "lines",
          linesClass: "split-line",
          onSplit: (self) =>
            gsap.from(self.lines, {
              yPercent: 110,
              duration: 1.1,
              ease: "expo.out",
              stagger: 0.09,
              delay,
              scrollTrigger: scroll ? { trigger: el, start } : undefined,
            }),
        });
      };
      if (document.fonts.status === "loaded") build();
      else document.fonts.ready.then(() => !cancelled && build());
      return () => {
        cancelled = true;
        split?.revert();
      };
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
