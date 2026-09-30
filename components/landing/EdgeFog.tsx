"use client";

import { useEffect, useRef } from "react";
import { getLenis, gsap, reducedMotion } from "@/lib/motion";

/**
 * Edge fog: fixed gradient bands at the top and bottom of the viewport whose
 * opacity follows the smooth-scroll velocity (fast attack, slow release), so
 * they only exist while the page moves and vanish at rest, at the very top and
 * at the very bottom. Landing only; not rendered at all under reduced motion
 * (and hidden by CSS as a backstop).
 *
 * Cost: one opacity write per band per frame while moving, nothing at rest.
 * Position comes from Lenis (no layout reads such as scrollHeight per frame).
 */
export default function EdgeFog() {
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reducedMotion()) return;
    const t = top.current;
    const b = bottom.current;
    if (!t || !b) return;
    let speed = 0;
    let shown = "";
    const tick = (_time: number, dt: number) => {
      const lenis = getLenis();
      if (!lenis) return;
      const v = Math.abs(lenis.velocity);
      if (v === 0 && speed === 0) return; // at rest: no work
      const target = Math.min(1, Math.pow(v / 70, 0.55));
      const k = Math.min(1, (dt / 1000) * (target > speed ? 14 : 4));
      speed += (target - speed) * k;
      if (speed < 0.01 && target === 0) speed = 0;
      const y = lenis.scroll;
      const atBottom = y >= lenis.limit - 4;
      const ft = y <= 2 ? 0 : speed;
      const fb = atBottom ? 0 : speed;
      const key = `${ft.toFixed(2)}${fb.toFixed(2)}`;
      if (key === shown) return;
      shown = key;
      t.style.opacity = ft.toFixed(2);
      b.style.opacity = fb.toFixed(2);
      t.toggleAttribute("data-on", ft > 0);
      b.toggleAttribute("data-on", fb > 0);
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  return (
    <>
      <div ref={top} className="l-fog t" aria-hidden />
      <div ref={bottom} className="l-fog b" aria-hidden />
    </>
  );
}
