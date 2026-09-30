"use client";

/**
 * Motion core for the App Router: plugins register once in the browser, one Lenis
 * instance runs on GSAP's ticker so smooth scroll and ScrollTrigger share a
 * clock, and nothing runs under prefers-reduced-motion.
 *
 * Cost rules (docs/DESIGN.md, "Motion budget"):
 * - Lenis only on desktops with a fine pointer that are not low-power
 *   (`html.lite`, set by the head script in app/layout.tsx). Touch devices and
 *   low-power machines scroll natively; every consumer handles `getLenis()`
 *   being null.
 * - Lenis has no rAF of its own (`autoRaf: false`); its tick sits on GSAP's
 *   ticker only while the page is scrolling, and comes off after a short rest,
 *   so an idle page runs no per-frame work for smooth scroll.
 * - ScrollTrigger refreshes are coalesced (`requestRefresh`) and skipped when
 *   no trigger exists.
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
  awake: boolean;
  restTimer: number;
  stopWake: (() => void) | null;
};

// Kept on globalThis so an HMR re-evaluation of this module finds the running
// instance instead of adding a second ticker callback.
const g = globalThis as typeof globalThis & { __mimirMotion?: MotionState };
const state: MotionState = (g.__mimirMotion ??= {
  lenis: null,
  tick: null,
  registered: false,
  awake: false,
  restTimer: 0,
  stopWake: null,
});

if (typeof window !== "undefined" && !state.registered) {
  gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
  // Mobile URL bars resize the viewport while scrolling; re-measuring every
  // pin on each of those is what makes pinned sections jump on phones.
  // limitCallbacks: triggers that were skipped past fire nothing on refresh.
  ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true });
  state.registered = true;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const MOTION_OK_QUERY = "(prefers-reduced-motion: no-preference)";

/** True when the user asked for reduced motion. Call inside effects only. */
export function reducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Low-power device (4 cores or fewer, 4GB or less, Save-Data): see app/layout.tsx. */
export function isLite(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("lite");
}

/** Smooth scroll runs only for motion-OK, fine-pointer, non-lite devices. */
export function smoothScrollAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (reducedMotion() || isLite()) return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/** True on devices with a real hover pointer (magnetic, tilt). */
export function canHover(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function getLenis(): Lenis | null {
  return state.lenis;
}

const REST_MS = 600;

/** Put the Lenis tick on the ticker (input or a programmatic scroll). */
function wake(): void {
  const lenis = state.lenis;
  if (!lenis || !state.tick) return;
  if (!state.awake) {
    state.awake = true;
    gsap.ticker.add(state.tick);
  }
  window.clearTimeout(state.restTimer);
  state.restTimer = window.setTimeout(rest, REST_MS);
}

/** Take it off again once Lenis has come to rest. */
function rest(): void {
  const lenis = state.lenis;
  if (!lenis || !state.tick) return;
  if (lenis.isScrolling) {
    state.restTimer = window.setTimeout(rest, REST_MS);
    return;
  }
  gsap.ticker.remove(state.tick);
  state.awake = false;
}

/** Start the single Lenis instance. No-op where smooth scroll is not allowed. */
export function startSmoothScroll(): Lenis | null {
  if (typeof window === "undefined") return null;
  if (state.lenis || !smoothScrollAllowed()) return state.lenis;
  const lenis = new Lenis({
    // Low lerp + reduced wheel multiplier: sections glide instead of jumping.
    lerp: 0.075,
    wheelMultiplier: 0.8,
    touchMultiplier: 1.4,
    // Menus, modals and wallet lists that scroll on their own keep working
    // even before they are tagged with data-lenis-prevent.
    allowNestedScroll: true,
    stopInertiaOnNavigate: true,
    // Driven from GSAP's ticker below, never from a second rAF loop.
    autoRaf: false,
  });
  lenis.on("scroll", ScrollTrigger.update);
  // Any scroll (smooth or native: keys, scrollbar) keeps the tick awake.
  lenis.on("scroll", wake);
  const tick = (time: number) => lenis.raf(time * 1000);
  state.lenis = lenis;
  state.tick = tick;
  // Programmatic scrolls (anchors, tabs) need the tick too.
  const scrollTo = lenis.scrollTo.bind(lenis);
  lenis.scrollTo = ((...args: Parameters<Lenis["scrollTo"]>) => {
    wake();
    return scrollTo(...args);
  }) as Lenis["scrollTo"];
  // Wake on the input itself, before Lenis handles it (capture, passive).
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const events = ["wheel", "pointerdown", "keydown"] as const;
  events.forEach((e) => window.addEventListener(e, wake, opts));
  state.stopWake = () => events.forEach((e) => window.removeEventListener(e, wake, opts));
  // No lag smoothing while Lenis runs: after a long task the scroll catches
  // up in one step instead of crawling behind the wheel.
  gsap.ticker.lagSmoothing(0);
  wake();
  return lenis;
}

/** Tear Lenis down (provider unmount, HMR, reduced motion switched on). */
export function stopSmoothScroll(): void {
  if (state.tick) gsap.ticker.remove(state.tick);
  window.clearTimeout(state.restTimer);
  state.stopWake?.();
  state.lenis?.destroy();
  state.lenis = null;
  state.tick = null;
  state.awake = false;
  state.stopWake = null;
  // Restore the default lag smoothing for plain GSAP tweens.
  gsap.ticker.lagSmoothing(500, 33);
}

let refreshQueued = 0;
/**
 * Re-measure scroll triggers (and Lenis) once, on the next frame after a
 * burst of callers (route change, fonts, data landing). Skipped when the page
 * has no triggers.
 */
export function requestRefresh(): void {
  if (typeof window === "undefined" || refreshQueued) return;
  refreshQueued = requestAnimationFrame(() => {
    refreshQueued = 0;
    state.lenis?.resize();
    if (ScrollTrigger.getAll().length > 0) ScrollTrigger.refresh();
  });
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
