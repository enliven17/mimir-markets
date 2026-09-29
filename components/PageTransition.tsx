"use client";

import { useRef, type ReactNode } from "react";
import { useRiseBatch } from "@/components/motion/useRiseBatch";

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Page entrance on GSAP: every `AnimatedItem` inside is a
 * `[data-rise]` element that rises in once when it scrolls into view
 * (components/motion/useRiseBatch.ts). Reduced motion: static.
 *
 * Kept with the same API so existing pages compile; later phases can drop the
 * wrapper and put `data-rise` straight on their sections.
 */
export default function PageTransition({ children, className = "" }: PageTransitionProps) {
  const ref = useRef<HTMLDivElement>(null);
  useRiseBatch(ref, { y: 32, duration: 1, stagger: 0.08, start: "top 90%" });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

export function AnimatedItem({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div data-rise className={className}>
      {children}
    </div>
  );
}
