"use client";

import { useRef, type ReactNode } from "react";
import { canHover, gsap, reducedMotion, useGSAP } from "@/lib/motion";

/**
 * Magnetic wrapper (pandock/web/src/components/Magnetic.tsx): the child leans
 * toward the pointer on gsap.quickTo with an elastic settle. Hover devices
 * only, off under reduced motion. Use for the landing CTAs and the closer CTA.
 */
export default function Magnetic({
  children,
  strength = 0.35,
  className = "",
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || reducedMotion() || !canHover()) return;
      const x = gsap.quickTo(el, "x", { duration: 0.6, ease: "elastic.out(1, 0.4)" });
      const y = gsap.quickTo(el, "y", { duration: 0.6, ease: "elastic.out(1, 0.4)" });
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        x((e.clientX - r.left - r.width / 2) * strength);
        y((e.clientY - r.top - r.height / 2) * strength);
      };
      const reset = () => {
        x(0);
        y(0);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", reset);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", reset);
      };
    },
    { scope: ref, dependencies: [strength] },
  );

  return (
    <span ref={ref} className={`magnetic ${className}`}>
      {children}
    </span>
  );
}
