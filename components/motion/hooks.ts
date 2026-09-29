"use client";

import { useEffect, useState, type RefObject } from "react";
import { REDUCED_MOTION_QUERY } from "@/lib/motion";

/** Live `prefers-reduced-motion: reduce` (false during SSR). */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduce;
}

/** True once the element has been at least `amount` visible (never flips back). */
export function useInViewOnce(ref: RefObject<Element | null>, amount = 0.05): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: amount },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, amount, seen]);
  return seen;
}
