"use client";

// HeroAscii — ASCII wave field on a 2D canvas (ported from the source repo's
// blueprint hero). Transparent background; glyphs are drawn in the theme's
// ink colour and blend into Solana purple at the wave peaks. Colours are read
// from the CSS tokens and re-read when the light/dark class flips. Draws a
// single static frame under prefers-reduced-motion and pauses offscreen.
import { useEffect, useRef } from "react";

type RGB = [number, number, number];

function readToken(name: string, fallback: RGB): RGB {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as RGB) : fallback;
}

export function HeroAscii() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    const chars = ".:-=+*#%@";
    const fontSize = 14;

    let W = 0;
    let H = 0;
    let cols = 0;
    let rows = 0;
    let base: RGB = [255, 255, 255];
    let peak: RGB = [255, 43, 43];
    let isDark = true;

    function readColors() {
      isDark = true; // dark only (docs/REDESIGN.md 1)
      base = readToken("--pv-border", [255, 255, 255]);
      peak = readToken("--pv-accent2", [255, 43, 43]);
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(W / (fontSize * 0.6));
      rows = Math.floor(H / fontSize);
    }

    let frame = 0;
    let animId = 0;
    let visible = true;

    function paint() {
      ctx!.clearRect(0, 0, W, H);
      ctx!.font = `${fontSize}px monospace`;
      const [br, bg, bb] = base;
      const [pr, pg, pb] = peak;
      // Ink on light paper needs less alpha to stay a background texture.
      const alphaScale = isDark ? 1 : 0.55;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const cx = x / cols - 0.5;
          const cy = y / rows - 0.5;
          const dist = Math.sqrt(cx * cx + cy * cy);
          const wave = Math.sin(dist * 12 - frame * 0.03) * 0.5 + 0.5;
          const noise =
            Math.sin(x * 0.3 + frame * 0.01) * Math.cos(y * 0.3 + frame * 0.02);
          const val = wave * 0.7 + noise * 0.3;
          const idx = Math.floor(Math.max(0, Math.min(1, val)) * (chars.length - 1));

          const alpha = (0.22 + val * 0.45) * alphaScale;
          const mix = Math.max(0, wave - 0.6) * 2.5; // 0..1 at wave peaks
          const r = Math.round(br * (1 - mix) + pr * mix);
          const g = Math.round(bg * (1 - mix) + pg * mix);
          const b = Math.round(bb * (1 - mix) + pb * mix);
          ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx!.fillText(chars[idx], x * fontSize * 0.6, y * fontSize + fontSize);
        }
      }
    }

    function loop() {
      if (!visible) return;
      paint();
      frame++;
      animId = requestAnimationFrame(loop);
    }

    function start() {
      cancelAnimationFrame(animId);
      if (reduced) paint();
      else loop();
    }

    readColors();
    resize();
    start();

    const onResize = () => {
      resize();
      if (reduced) paint();
    };
    window.addEventListener("resize", onResize);

    const themeObs = new MutationObserver(() => {
      readColors();
      if (reduced) paint();
    });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const io = new IntersectionObserver(([entry]) => {
      const next = entry?.isIntersecting ?? true;
      if (next === visible) return;
      visible = next;
      if (visible) start();
      else cancelAnimationFrame(animId);
    });
    io.observe(canvas);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      themeObs.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
    />
  );
}

export default HeroAscii;
