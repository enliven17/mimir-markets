"use client";

import { useEffect, useRef } from "react";
import { getLenis, gsap, reducedMotion } from "@/lib/motion";

/**
 * Edge fog: fixed bands at the top and bottom of the viewport made of five
 * stacked backdrop blurs. Their strength follows the smooth-scroll velocity
 * (fast attack, slow release), so they only exist while the page moves and
 * vanish at rest, at the very top and at the very bottom. Landing only; not
 * rendered at all under reduced motion (and hidden by CSS as a backstop).
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
      const v = Math.abs(lenis?.velocity ?? 0);
      const target = Math.min(1, Math.pow(v / 70, 0.55));
      const k = Math.min(1, (dt / 1000) * (target > speed ? 14 : 4));
      speed += (target - speed) * k;
      const sp = speed < 0.01 ? 0 : speed;
      const y = window.scrollY;
      const doc = document.scrollingElement ?? document.documentElement;
      const atBottom = y + window.innerHeight >= doc.scrollHeight - 4;
      const ft = y <= 2 ? 0 : sp;
      const fb = atBottom ? 0 : sp;
      const key = `${ft.toFixed(2)}${fb.toFixed(2)}`;
      if (key === shown) return;
      shown = key;
      t.style.setProperty("--f", ft.toFixed(3));
      b.style.setProperty("--f", fb.toFixed(3));
      t.toggleAttribute("data-on", ft > 0);
      b.toggleAttribute("data-on", fb > 0);
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  const layers = [0, 1, 2, 3, 4].map((i) => <i key={i} />);
  return (
    <>
      <div ref={top} className="l-fog t" aria-hidden>
        {layers}
      </div>
      <div ref={bottom} className="l-fog b" aria-hidden>
        {layers}
      </div>
    </>
  );
}
