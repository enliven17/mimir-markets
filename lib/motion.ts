"use client";

/**
 * Motion core for the App Router: plugins register once in the browser, one Lenis
 * instance runs on GSAP's ticker so smooth scroll and ScrollTrigger share a
 * clock, and nothing runs under prefers-reduced-motion.
 *
 * Client-only. Never import this from a server component.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";

type MotionState = {
  lenis: Lenis | null;
  tick: ((time: number) => void) | null;
  registered: boolean;
};

// Kept on globalThis so an HMR re-evaluation of this module finds the running
// instance instead of adding a second ticker callback.
const g = globalThis as typeof globalThis & { __mimirMotion?: MotionState };
const state: MotionState = (g.__mimirMotion ??= {
  lenis: null,
  tick: null,
  registered: false,
});

if (typeof window !== "undefined" && !state.registered) {
  gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
  // Mobile URL bars resize the viewport while scrolling; re-measuring every
  // pin on each of those is what makes pinned sections jump on phones.
  ScrollTrigger.config({ ignoreMobileResize: true });
  state.registered = true;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const MOTION_OK_QUERY = "(prefers-reduced-motion: no-preference)";

/** True when the user asked for reduced motion. Call inside effects only. */
export function reducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** True on devices with a real hover pointer (magnetic, tilt). */
export function canHover(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function getLenis(): Lenis | null {
  return state.lenis;
}

/** Start the single Lenis instance. No-op under reduced motion. */
export function startSmoothScroll(): Lenis | null {
  if (typeof window === "undefined") return null;
  if (state.lenis || reducedMotion()) return state.lenis;
  const lenis = new Lenis({
    // Low lerp + reduced wheel multiplier: sections glide instead of jumping.
    lerp: 0.075,
    wheelMultiplier: 0.8,
    touchMultiplier: 1.4,
    // Menus, modals and wallet lists that scroll on their own keep working
    // even before they are tagged with data-lenis-prevent.
    allowNestedScroll: true,
    stopInertiaOnNavigate: true,
  });
  lenis.on("scroll", ScrollTrigger.update);
  const tick = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  state.lenis = lenis;
  state.tick = tick;
  return lenis;
}

/** Tear Lenis down (provider unmount, HMR, reduced motion switched on). */
export function stopSmoothScroll(): void {
  if (state.tick) gsap.ticker.remove(state.tick);
  state.lenis?.destroy();
  state.lenis = null;
  state.tick = null;
  // Restore the default lag smoothing for plain GSAP tweens.
  gsap.ticker.lagSmoothing(500, 33);
}

/** Pause smooth scroll while an overlay is open (menus, sheets, modals). */
export function setScrollLocked(locked: boolean): void {
  if (locked) state.lenis?.stop();
  else state.lenis?.start();
}

/** Scroll to an in-page anchor, through Lenis when it runs. */
export function scrollToHash(hash: string, offset = -72): void {
  if (!hash || hash === "#") return;
  let el: HTMLElement | null = null;
  try {
    el = document.querySelector(hash) as HTMLElement | null;
  } catch {
    return;
  }
  if (!el) return;
  if (state.lenis) state.lenis.scrollTo(el, { offset, force: true });
  else el.scrollIntoView();
}

/** Jump to the top without animation (route changes). */
export function scrollToTop(): void {
  if (state.lenis) state.lenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

export { gsap, ScrollTrigger, SplitText, useGSAP };
