/**
 * Expressions are small deltas from NEUTRAL; animations are sequences of expressions with holds. Both are plain
 * data, so the same face can be drawn by React (components/avatar) or as an SVG string (next/og), and tested here.
 */
import { hash, rng } from "./spec";

export type EyeShape = "open" | "wide" | "squint" | "happy" | "x" | "closed";
export type MouthShape = "rest" | "smile" | "grin" | "frown" | "o" | "flat" | "wavy";
export type Brow = "none" | "focused" | "worried" | "raised";
export type Overlay = "none" | "reticle" | "dots" | "zzz" | "sparkle" | "sweat";
export type Tint = "none" | "bid" | "ask" | "grey";

export interface Face {
  /** One shape for both eyes, or [left, right]. */
  eyes: EyeShape | readonly [EyeShape, EyeShape];
  /** Where the pupils point, each -1..1 (x right, y down). */
  look: { x: number; y: number };
  mouth: MouthShape;
  brow: Brow;
  overlay: Overlay;
  /** A mark, never a fill: a small square on the body and, on light bodies, the mouth. */
  tint: Tint;
  /** Body offset in grid units, negative is up (hops). */
  lift: number;
}

export const NEUTRAL: Face = { eyes: "open", look: { x: 0, y: 0 }, mouth: "rest", brow: "none", overlay: "none", tint: "none", lift: 0 };

export const MOODS = ["neutral", "scanning", "thinking", "aiming", "bought", "won", "lost", "paused", "killed"] as const;
export type Mood = (typeof MOODS)[number];
/** Moods plus short reactions to the person looking at the agent. */
export type ExpressionName = Mood | "curious" | "surprised" | "concerned" | "happy";

export const EXPRESSIONS: Record<ExpressionName, Partial<Face>> = {
  neutral: {},
  scanning: { look: { x: -1, y: 0 } },
  thinking: { look: { x: 0.6, y: -1 }, overlay: "dots", mouth: "flat" },
  aiming: { eyes: ["squint", "open"], overlay: "reticle", brow: "focused", mouth: "flat" },
  bought: { eyes: "wide", mouth: "grin", lift: -1 },
  won: { eyes: "happy", mouth: "smile", tint: "bid", overlay: "sparkle" },
  lost: { eyes: "open", look: { x: 0, y: 1 }, mouth: "frown", brow: "worried", tint: "ask" },
  paused: { eyes: "closed", mouth: "flat", overlay: "zzz" },
  killed: { eyes: "x", mouth: "flat", tint: "grey" },
  curious: { eyes: "wide", look: { x: 0, y: 0 }, brow: "raised" },
  surprised: { eyes: "wide", mouth: "o", brow: "raised", lift: -1 },
  concerned: { brow: "worried", mouth: "wavy", overlay: "sweat" },
  happy: { eyes: "happy", mouth: "smile" },
};

/** NEUTRAL with an expression (by name or as a delta) applied. */
export function faceOf(e: ExpressionName | Partial<Face>): Face {
  const d = typeof e === "string" ? EXPRESSIONS[e] : e;
  return { ...NEUTRAL, ...d, look: { ...NEUTRAL.look, ...(d.look ?? {}) } };
}

export interface Step {
  face: ExpressionName | Partial<Face>;
  /** ms to hold this step. */
  hold: number;
}
export interface Animation {
  steps: readonly Step[];
  loop: boolean;
  /** Blink while this plays (not when the eyes are closed or crossed out anyway). */
  blink: boolean;
}

export type AnimationName = "idle" | "scanning" | "thinking" | "aiming" | "bought" | "won" | "lost" | "paused" | "killed" | "celebrate" | "poke" | "concern" | "lookAtYou";

const hold = (face: Step["face"], ms: number): Step => ({ face, hold: ms });

export const ANIMATIONS: Record<AnimationName, Animation> = {
  idle: { loop: true, blink: true, steps: [hold("neutral", 4200), hold({ look: { x: -0.5, y: 0 } }, 900), hold("neutral", 2600), hold({ look: { x: 0.5, y: 0.3 } }, 900)] },
  // Eyes sweep left and right, pausing at each end.
  scanning: { loop: true, blink: true, steps: [hold("scanning", 900), hold({ ...EXPRESSIONS.scanning, look: { x: 0, y: 0 } }, 260), hold({ ...EXPRESSIONS.scanning, look: { x: 1, y: 0 } }, 900), hold({ ...EXPRESSIONS.scanning, look: { x: 0, y: 0 } }, 260)] },
  thinking: { loop: true, blink: true, steps: [hold("thinking", 1500), hold({ ...EXPRESSIONS.thinking, look: { x: -0.6, y: -1 } }, 1500)] },
  aiming: { loop: true, blink: false, steps: [hold("aiming", 2200), hold({ ...EXPRESSIONS.aiming, look: { x: 0.4, y: 0 } }, 700), hold({ ...EXPRESSIONS.aiming, look: { x: -0.3, y: 0 } }, 700)] },
  bought: { loop: true, blink: true, steps: [hold("bought", 1600), hold({ ...EXPRESSIONS.bought, lift: 0 }, 2400)] },
  won: { loop: true, blink: false, steps: [hold("won", 3000), hold({ ...EXPRESSIONS.won, overlay: "none" }, 1400)] },
  lost: { loop: true, blink: true, steps: [hold("lost", 3200), hold({ ...EXPRESSIONS.lost, look: { x: -0.5, y: 1 } }, 1600)] },
  paused: { loop: true, blink: false, steps: [hold("paused", 1800), hold({ ...EXPRESSIONS.paused, overlay: "none" }, 900)] },
  killed: { loop: false, blink: false, steps: [hold("killed", 0)] },
  // One-shots: play, then the mood's loop resumes.
  celebrate: { loop: false, blink: false, steps: [hold("surprised", 160), hold({ ...EXPRESSIONS.won, lift: -2, tint: "none" }, 180), hold({ ...EXPRESSIONS.won, lift: 0, tint: "none" }, 140), hold({ ...EXPRESSIONS.won, lift: -2, tint: "none" }, 180), hold({ ...EXPRESSIONS.happy, lift: 0 }, 1800)] },
  poke: { loop: false, blink: false, steps: [hold("surprised", 220), hold("happy", 700)] },
  concern: { loop: false, blink: true, steps: [hold("concerned", 2600)] },
  lookAtYou: { loop: false, blink: false, steps: [hold("curious", 900)] },
};

/** The loop each mood plays at rest. */
export const MOOD_ANIMATION: Record<Mood, AnimationName> = {
  neutral: "idle", scanning: "scanning", thinking: "thinking", aiming: "aiming", bought: "bought", won: "won", lost: "lost", paused: "paused", killed: "killed",
};

/** The still frame of a mood: what the server renders and what reduced motion keeps. */
export const restingFace = (m: Mood): Face => faceOf(m);

export const BLINK_MS = 130;
export const BLINK_GAP = { min: 3000, max: 6000 } as const;

/** Seeded gaps between blinks, 3-6 s, so two agents never blink in step but each one is repeatable. */
export function blinkGaps(seed: string): () => number {
  const r = rng(hash(`blink:${seed}`));
  return () => Math.round(BLINK_GAP.min + r() * (BLINK_GAP.max - BLINK_GAP.min));
}

/** The face with its eyes shut for a blink (crossed-out or already closed eyes stay as they are). */
export function blinked(f: Face): Face {
  const shut = (e: EyeShape): EyeShape => (e === "x" || e === "happy" ? e : "closed");
  const eyes = typeof f.eyes === "string" ? shut(f.eyes) : ([shut(f.eyes[0]), shut(f.eyes[1])] as const);
  return { ...f, eyes };
}
