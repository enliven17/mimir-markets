"use client";

/**
 * ASCII wave field behind the landing hero (renderer: components/hero-ascii).
 *
 * Budget, so it never costs the page a frame:
 * - Runs in a worker on an OffscreenCanvas where the browser supports it; the
 *   main thread only forwards size and visibility. Otherwise it draws on the
 *   main thread at a lower frame rate.
 * - Device pixel ratio capped at 1.5 (1 on low-power devices, `html.lite`).
 * - 24fps, 12fps on low-power devices and on the main-thread fallback.
 * - Starts on an idle callback, so it never competes with hydration; stops
 *   while offscreen or in a hidden tab.
 * - Reduced motion or Save-Data: one static frame.
 */
import { useEffect, useRef } from "react";
import { createField, type RGB } from "./hero-ascii/field";

function readToken(name: string, fallback: RGB): RGB {
  const parts = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as RGB) : fallback;
}

function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(c?.saveData);
}

interface Driver {
  resize(width: number, height: number): void;
  run(on: boolean): void;
  destroy(): void;
}

function workerDriver(canvas: HTMLCanvasElement, init: Record<string, unknown>): Driver | null {
  if (typeof Worker === "undefined" || !("transferControlToOffscreen" in canvas)) return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./hero-ascii/hero-ascii.worker.ts", import.meta.url), { type: "module" });
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: "init", canvas: offscreen, ...init }, [offscreen]);
  } catch {
    return null;
  }
  return {
    resize: (width, height) => worker.postMessage({ type: "resize", width, height }),
    run: (on) => worker.postMessage({ type: "run", on }),
    destroy: () => worker.terminate(),
  };
}

function mainDriver(
  canvas: HTMLCanvasElement,
  init: { width: number; height: number; dpr: number; base: RGB; peak: RGB; fps: number; still: boolean },
): Driver | null {
  const makeCanvas = (w: number, h: number) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  const field = createField(canvas, makeCanvas, init);
  if (!field) return null;
  field.resize(init.width, init.height);
  let frame = 0;
  field.paint(frame);
  const frameMs = 1000 / init.fps;
  let raf = 0;
  let last = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (now - last < frameMs) return;
    last = now;
    field.paint(frame);
    frame += 1.4 * (frameMs / (1000 / 24));
  };
  return {
    resize: (w, h) => {
      field.resize(w, h);
      field.paint(frame);
    },
    run: (on) => {
      cancelAnimationFrame(raf);
      if (on && !init.still) raf = requestAnimationFrame(loop);
    },
    destroy: () => cancelAnimationFrame(raf),
  };
}

export function HeroAscii({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const lite = document.documentElement.classList.contains("lite");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || saveData();
    let driver: Driver | null = null;
    let visible = true;

    const sync = () => driver?.run(visible && !document.hidden);

    const boot = () => {
      const rect = canvas.getBoundingClientRect();
      const init = {
        width: rect.width,
        height: rect.height,
        dpr: lite ? 1 : Math.min(window.devicePixelRatio || 1, 1.5),
        base: readToken("--cream-rgb", [243, 234, 214]),
        peak: readToken("--coral-rgb", [255, 81, 72]),
        fps: lite ? 12 : 24,
        still,
      };
      driver = workerDriver(canvas, init) ?? mainDriver(canvas, { ...init, fps: 12 });
      sync();
    };

    const hasIdle = typeof window.requestIdleCallback === "function";
    const idle = hasIdle ? window.requestIdleCallback(boot, { timeout: 1500 }) : window.setTimeout(boot, 300);

    let resizeTimer = 0;
    const ro = new ResizeObserver(([entry]) => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const box = entry?.contentRect;
        if (box && driver) driver.resize(box.width, box.height);
      }, 150);
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", sync);

    return () => {
      if (hasIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      window.clearTimeout(resizeTimer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      driver?.destroy();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}

export default HeroAscii;
