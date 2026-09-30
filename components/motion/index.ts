// Motion primitives. Client-only.
// Outside the landing, import the file you need ("@/components/motion/RollingNumber"):
// the barrel pulls SplitReveal, and with it SplitText, into the bundle.
export { default as MotionProvider } from "./MotionProvider";
export { default as SplitReveal } from "./SplitReveal";
export { default as Magnetic } from "./Magnetic";
export { default as RollingNumber } from "./RollingNumber";
export { default as Marquee } from "./Marquee";
export { useDitherReveal } from "./useDitherReveal";
export { useRiseBatch } from "./useRiseBatch";
export { usePrefersReducedMotion, useInViewOnce } from "./hooks";
