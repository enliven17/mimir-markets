"use client";

import { useEffect, useRef } from "react";
import { reducedMotion } from "@/lib/motion";

/**
 * A marker scribble in chunky pixels under the hero's accent word: a wobbly
 * stroke out, a flick down, and a looser stroke back that stops short. Seeded,
 * so it is the same scribble on every load. It draws itself in once the
 * headline has arrived (`delay` ms); reduced motion shows it finished.
 */
export default function Scribble({ delay = 1900 }: { delay?: number }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    const g = c?.getContext("2d");
    if (!wrap || !c || !g) return;

    const reduce = reducedMotion();
    let pts: [number, number][] = [];
    let cols = 0;
    let rows = 0;
    let prog = reduce ? 1 : 0;

    const draw = () => {
      g.clearRect(0, 0, cols, rows);
      const n = Math.floor(pts.length * prog);
      for (let i = 0; i < n; i++) {
        const [x, y] = pts[i];
        g.fillStyle = i % 7 === 0 ? "#ff5148" : "#ff2b2b";
        g.fillRect(x, y, 1, i % 4 === 0 ? 2 : 1);
      }
    };

    const build = () => {
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const r = wrap.getBoundingClientRect();
      if (!r.width) return;
      const fs = parseFloat(getComputedStyle(wrap.parentElement ?? wrap).fontSize) || 64;
      const px = Math.max(2, Math.round(fs * 0.032));
      cols = Math.max(8, Math.floor(r.width / px));
      rows = Math.max(4, Math.floor(r.height / px));
      c.width = cols;
      c.height = rows;
      pts = [];
      const plot = (x: number, y: number) => pts.push([Math.round(x), Math.round(y)]);
      for (let x = 1; x < cols - 2; x += 0.5)
        plot(x, rows * 0.36 + Math.sin((x / cols) * Math.PI * 1.6 + 0.4) * rows * 0.05 + (rnd() - 0.5) * 0.5);
      for (let k = 0; k < 1; k += 0.05) plot(cols - 2 - k * 3, rows * 0.36 + k * rows * 0.26);
      for (let x = cols - 5; x > cols * 0.06; x -= 0.5)
        plot(x, rows * 0.62 + Math.sin((x / cols) * Math.PI * 1.3 + 2) * rows * 0.05 + (rnd() - 0.5) * 0.5);
      draw();
    };

    const ro = new ResizeObserver(build);
    ro.observe(wrap);
    let cancelled = false;
    document.fonts?.ready.then(() => !cancelled && build());
    build();

    let raf = 0;
    const timer = reduce
      ? 0
      : window.setTimeout(() => {
          const t0 = performance.now();
          const tick = (now: number) => {
            prog = Math.min(1, (now - t0) / 650);
            draw();
            if (prog < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        }, delay);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [delay]);

  return (
    <span ref={wrapRef} className="l-scribble" aria-hidden>
      <canvas ref={canvasRef} />
    </span>
  );
}
