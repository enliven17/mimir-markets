/**
 * Ritual motion presets, framework-neutral GSAP vars. Each preset is
 * a `{ from, to }` pair of GSAP vars, used as
 * `gsap.fromTo(el, ritual.from, ritual.to)` inside `useGSAP` (lib/motion.ts),
 * plus CSS easing strings that match radio's motion tokens.
 * Callers must skip them under reduced motion (`reducedMotion()`).
 */

/* ── Shared easings (CSS cubic-bezier strings) ── */
export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";
export const EASE_SPRING = "cubic-bezier(0.22, 1, 0.36, 1)";
/** @deprecated old PROVEN curve, kept for callers that pass it to CSS. */
export const PROVEN_EASE = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
export const SNAP_EASE = EASE_SPRING;

type Vars = Record<string, string | number>;
export type Ritual = { from: Vars; to: Vars };

/** Seal stamp: challenge created / claim issued. */
export const sealStamp: Ritual = {
  from: { opacity: 0, scale: 1.8, rotate: -8 },
  to: { opacity: 1, scale: 1, rotate: -8, duration: 0.55, ease: "power2.out" },
};

/** Phase shift: status text swap (OPEN → LOCKED → VERIFYING → PROVEN). */
export const phaseShift: Ritual = {
  from: { opacity: 0, y: 8, filter: "blur(4px)" },
  to: { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.4, ease: "power2.out" },
};

/** Verdict word: brief pause, then the result lands. */
export const verdictWord: Ritual = {
  from: { opacity: 0, scale: 1.6, letterSpacing: "0.5em" },
  to: { opacity: 1, scale: 1, letterSpacing: "0.2em", duration: 0.7, delay: 0.35, ease: "expo.out" },
};

/** Kinetic text: stagger words/letters in (pass `stagger` in `to`). */
export const kineticLetter: Ritual = {
  from: { opacity: 0, y: 20, filter: "blur(6px)" },
  to: { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.35, ease: "power2.out", stagger: 0.04, delay: 0.1 },
};

/** Stagger item: the generic rise used by lists. */
export const staggerItem: Ritual = {
  from: { opacity: 0, y: 18 },
  to: { opacity: 1, y: 0, duration: 0.45, ease: "power2.out", stagger: 0.07 },
};

/** Slide in from a direction. */
export function slideIn(direction: "left" | "right" | "up" | "down", distance = 40): Ritual {
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const key = horizontal ? "x" : "y";
  return {
    from: { opacity: 0, [key]: distance * sign },
    to: { opacity: 1, [key]: 0, duration: 0.5, ease: "power2.out" },
  };
}
