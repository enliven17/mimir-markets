"use client";

/**
 * ASCII wave field behind the landing hero. Glyphs are cream and turn coral
 * at the wave peaks. Slim by design: every glyph and colour step is drawn
 * once into a small atlas, each frame is only `drawImage` calls, the loop is
 * capped at 24fps, the first frame waits for an idle moment so it never
 * competes with hydration, and it stops while offscreen or in a hidden tab.
 * Reduced motion: one static frame.
 */
import { useEffect, useRef } from "react";

type RGB = [number, number, number];

const CHARS = ".:-=+*#%@";
const ALPHA_STEPS = 6;
const MIX_STEPS = 4;
const FRAME_MS = 1000 / 24;

function readToken(name: string, fallback: RGB): RGB {
  const parts = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as RGB) : fallback;
}

export function HeroAscii({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = readToken("--cream-rgb", [243, 234, 214]);
    const peak = readToken("--coral-rgb", [255, 81, 72]);

    let W = 0;
    let H = 0;
    let cols = 0;
    let rows = 0;
    let cell = 14;
    let cw = 8.4;
    let atlas: HTMLCanvasElement | null = null;

    // Atlas: one row per (alpha, mix) step, one column per glyph.
    function buildAtlas() {
      const a = document.createElement("canvas");
      a.width = Math.ceil(cw * dpr) * CHARS.length;
      a.height = Math.ceil(cell * dpr) * ALPHA_STEPS * MIX_STEPS;
      const g = a.getContext("2d");
      if (!g) return null;
      const gw = Math.ceil(cw * dpr);
      const gh = Math.ceil(cell * dpr);
      g.font = `${cell * dpr}px ui-monospace, monospace`;
      g.textBaseline = "alphabetic";
      for (let ai = 0; ai < ALPHA_STEPS; ai++) {
        for (let mi = 0; mi < MIX_STEPS; mi++) {
          const mix = mi / (MIX_STEPS - 1);
          const alpha = 0.18 + (ai / (ALPHA_STEPS - 1)) * 0.42;
          const r = Math.round(base[0] * (1 - mix) + peak[0] * mix);
          const gg = Math.round(base[1] * (1 - mix) + peak[1] * mix);
          const b = Math.round(base[2] * (1 - mix) + peak[2] * mix);
          g.fillStyle = `rgba(${r}, ${gg}, ${b}, ${alpha})`;
          const row = ai * MIX_STEPS + mi;
          for (let ci = 0; ci < CHARS.length; ci++) {
            g.fillText(CHARS[ci], ci * gw, row * gh + gh * 0.85);
          }
        }
      }
      return a;
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      // Bigger cells on phones: fewer glyphs, same texture.
      cell = W < 640 ? 16 : 14;
      cw = cell * 0.6;
      canvas!.width = Math.round(W * dpr);
      canvas!.height = Math.round(H * dpr);
      cols = Math.ceil(W / cw);
      rows = Math.ceil(H / cell);
      atlas = buildAtlas();
    }

    let frame = 0;
    function paint() {
      if (!atlas) return;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const gw = Math.ceil(cw * dpr);
      const gh = Math.ceil(cell * dpr);
      for (let y = 0; y < rows; y++) {
        const cy = y / rows - 0.5;
        for (let x = 0; x < cols; x++) {
          const cx = x / cols - 0.5;
          const dist = Math.sqrt(cx * cx + cy * cy);
          const wave = Math.sin(dist * 12 - frame * 0.03) * 0.5 + 0.5;
          const noise = Math.sin(x * 0.3 + frame * 0.01) * Math.cos(y * 0.3 + frame * 0.02);
          const val = Math.max(0, Math.min(1, wave * 0.7 + noise * 0.3));
          const ci = Math.floor(val * (CHARS.length - 1));
          const ai = Math.round(val * (ALPHA_STEPS - 1));
          const mi = Math.round(Math.min(1, Math.max(0, wave - 0.6) * 2.5) * (MIX_STEPS - 1));
          ctx!.drawImage(atlas, ci * gw, (ai * MIX_STEPS + mi) * gh, gw, gh, Math.round(x * cw * dpr), Math.round(y * cell * dpr), gw, gh);
        }
      }
    }

    let raf = 0;
    let last = 0;
    let visible = true;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      paint();
      frame += 1.4;
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (reduced) paint();
      else if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    };

    let idle = 0;
    const boot = () => {
      resize();
      start();
    };
    const hasIdle = typeof window.requestIdleCallback === "function";
    if (hasIdle) idle = window.requestIdleCallback(boot, { timeout: 1200 });
    else idle = window.setTimeout(boot, 200);

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        if (reduced) paint();
      }, 120);
    };
    window.addEventListener("resize", onResize);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) start();
      else cancelAnimationFrame(raf);
    });
    io.observe(canvas);
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      if (hasIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      io.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}

export default HeroAscii;
