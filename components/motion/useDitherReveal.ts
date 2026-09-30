"use client";

import { useEffect, type RefObject } from "react";
import { reducedMotion } from "@/lib/motion";

/**
 * Dither entrance: an 8x8 ordered-dither (Bayer) mask stepped from empty
 * to solid, with a small rise from the scroll direction. Reversible: leave the
 * viewport and the element dithers out, come back and it dithers in again.
 *
 * Mark elements with `data-dither` (optional `data-cell` px, `data-dur` ms,
 * `data-d` delay ms) inside the scope. Under JS + motion the CSS guard in
 * globals.css hides them until the hook has applied the empty mask.
 * Reduced motion: a 300ms opacity fade instead.
 *
 * Use for the hero heading and section heads only; everything else uses
 * `useRiseBatch` so the page does not get busy.
 */

function bayer(n: number): number[][] {
  if (n === 1) return [[0]];
  const m = bayer(n / 2);
  const out: number[][] = [];
  for (let y = 0; y < n; y++) {
    out.push([]);
    for (let x = 0; x < n; x++) {
      const b = m[y % (n / 2)][x % (n / 2)] * 4;
      out[y].push(b + [[0, 2], [3, 1]][y < n / 2 ? 0 : 1][x < n / 2 ? 0 : 1]);
    }
  }
  return out;
}

const B8 = bayer(8);
const maskCache = new Map<number, string[]>();

function masks(cell: number): string[] {
  const cached = maskCache.get(cell);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = cell * 8;
  const g = c.getContext("2d");
  const out: string[] = [];
  for (let lvl = 0; lvl <= 64; lvl++) {
    if (g) {
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = "#000";
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) if (B8[y][x] < lvl) g.fillRect(x * cell, y * cell, cell, cell);
    }
    out.push(`url(${c.toDataURL()})`);
  }
  maskCache.set(cell, out);
  return out;
}

function setMask(el: HTMLElement, url: string, size: string) {
  el.style.setProperty("-webkit-mask-image", url);
  el.style.maskImage = url;
  el.style.setProperty("-webkit-mask-size", size);
  el.style.maskSize = size;
}

export function useDitherReveal(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-dither]"));
    if (root.hasAttribute("data-dither")) els.unshift(root);
    if (els.length === 0) return;

    const reduce = reducedMotion();
    const state = new WeakMap<HTMLElement, { shown: boolean; tok: number }>();
    const st = (el: HTMLElement) => {
      let s = state.get(el);
      if (!s) {
        s = { shown: false, tok: 0 };
        state.set(el, s);
      }
      return s;
    };
    const cellOf = (el: HTMLElement) => Number(el.dataset.cell || 7);
    const sizeOf = (el: HTMLElement) => `${cellOf(el) * 8}px ${cellOf(el) * 8}px`;
    let scrollDir = 1;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y !== lastY) scrollDir = y > lastY ? 1 : -1;
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const timers = new Set<number>();
    const frames = new Set<number>();

    const hide = (el: HTMLElement) => {
      const s = st(el);
      s.tok++;
      s.shown = false;
      if (reduce) {
        el.style.opacity = "0";
      } else {
        setMask(el, masks(cellOf(el))[0], sizeOf(el));
        el.style.transform = "";
      }
      el.setAttribute("data-dither-ready", "");
    };

    const show = (el: HTMLElement, delay = 0, dur = 1150) => {
      const s = st(el);
      const tok = ++s.tok;
      s.shown = true;
      if (reduce) {
        el.style.transition = "opacity 300ms ease";
        el.style.opacity = "1";
        return;
      }
      const m = masks(cellOf(el));
      const size = sizeOf(el);
      const rise = 36 * scrollDir;
      const t = window.setTimeout(() => {
        timers.delete(t);
        if (tok !== s.tok) return;
        const t0 = performance.now();
        let shownLevel = -1;
        const step = (now: number) => {
          if (tok !== s.tok) return;
          const k = Math.min(1, (now - t0) / dur);
          const e = 1 - Math.pow(1 - k, 3);
          // A new mask image repaints the whole masked element, so step it in
          // 17 levels and only when the level changes; the rise stays smooth.
          const level = Math.round(e * 16) * 4;
          if (level !== shownLevel) {
            shownLevel = level;
            setMask(el, m[level], size);
          }
          el.style.transform = `translateY(${(1 - e) * rise}px)`;
          if (k < 1) {
            const f = requestAnimationFrame(step);
            frames.add(f);
          } else {
            setMask(el, "none", "auto");
            el.style.transform = "";
          }
        };
        const f = requestAnimationFrame(step);
        frames.add(f);
      }, delay);
      timers.add(t);
    };

    els.forEach(hide);

    const io = new IntersectionObserver(
      (entries) => {
        let i = 0;
        for (const e of entries) {
          const el = e.target as HTMLElement;
          const s = st(el);
          const tall = e.boundingClientRect.height > window.innerHeight * 0.8;
          if (e.isIntersecting && (e.intersectionRatio >= 0.12 || tall)) {
            if (!s.shown) {
              const own = Number(el.dataset.d || 0);
              show(el, own + i++ * 90, Number(el.dataset.dur || 1150));
            }
          } else if (!e.isIntersecting && s.shown) hide(el);
        }
      },
      { threshold: [0, 0.12] },
    );
    els.forEach((el) => io.observe(el));

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      timers.forEach((t) => window.clearTimeout(t));
      frames.forEach((f) => cancelAnimationFrame(f));
      els.forEach((el) => {
        setMask(el, "", "");
        el.style.transform = "";
        el.style.opacity = "";
        el.style.transition = "";
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export default useDitherReveal;
