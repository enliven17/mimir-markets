/**
 * An agent's face, drawn from a seed string (by default its slug). Same seed, same face, on the server, in the
 * browser and in next/og. A face is a few primitives on a 32x32 pixel grid: a stepped body, eyes, a mouth and an
 * optional accessory, in brand colours only. Expressions (./face.ts) are deltas on top of it.
 *
 * Seed format: `<base>[~<n>][|b:<body>][|e:<eyes>][|c:<colour>]`. `~n` is a reroll, the `|k:v` parts are the
 * launch wizard's pickers. Everything not picked comes from the hash of the base.
 */

export const BODIES = ["squircle", "capsule", "blob", "block"] as const;
export const EYES = ["pixel", "round", "visor", "cyclops"] as const;
export const MOUTHS = ["line", "smile", "grill", "dot"] as const;
// Mimir is the Norse head of wisdom: a horned helm, a beard, the Mannaz rune (ᛗ, "M") or a crest.
export const ACCESSORIES = ["none", "horns", "beard", "rune", "crest"] as const;
export const COLOURS = ["red", "cream", "coral", "ink", "deep"] as const;

export type BodyShape = (typeof BODIES)[number];
export type EyeStyle = (typeof EYES)[number];
export type MouthStyle = (typeof MOUTHS)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type ColourName = (typeof COLOURS)[number];

export interface AvatarSpec {
  seed: string;
  body: BodyShape;
  /** Body size in grid units (the grid is 32x32). Even width keeps the face centred on a pixel. */
  bodyW: number;
  bodyH: number;
  eyes: EyeStyle;
  /** Extra units between the two eyes (ignored by cyclops). */
  eyeGap: number;
  /** Eye row nudge, -1..1. */
  eyeY: number;
  mouth: MouthStyle;
  accessory: Accessory;
  colour: ColourName;
}

export interface AvatarPicks {
  reroll?: number;
  body?: BodyShape;
  eyes?: EyeStyle;
  colour?: ColourName;
}

export const GRID = 32;
export const BODY_W = { min: 16, max: 24 } as const;
export const BODY_H = { min: 14, max: 20 } as const;
export const SEED_MAX = 64;
/** What may be stored as an agent's avatarSeed. */
export const AVATAR_SEED_RE = /^[a-z0-9][a-z0-9~|:-]{0,63}$/;

/** FNV-1a, 32 bit. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for faces and blink timing. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
const includes = <T extends string>(xs: readonly T[], v: string | undefined): v is T => v !== undefined && (xs as readonly string[]).includes(v);

/** Splits a seed into its base (with any reroll) and the pickers. Unknown or malformed parts are ignored. */
export function parseAvatarSeed(seed: string): { base: string; picks: AvatarPicks } {
  const [head, ...mods] = seed.split("|");
  const [base, n] = head.split("~");
  const picks: AvatarPicks = {};
  const reroll = Number(n);
  if (n !== undefined && Number.isInteger(reroll) && reroll > 0) picks.reroll = reroll;
  for (const m of mods) {
    const [k, v] = m.split(":");
    if (k === "b" && includes(BODIES, v)) picks.body = v;
    else if (k === "e" && includes(EYES, v)) picks.eyes = v;
    else if (k === "c" && includes(COLOURS, v)) picks.colour = v;
  }
  return { base: base || "agent", picks };
}

/** The inverse of parseAvatarSeed: what the launch wizard stores. No picks = the bare base (the slug). */
export function encodeAvatarSeed(base: string, picks: AvatarPicks = {}): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "agent";
  let s = picks.reroll ? `${clean}~${picks.reroll}` : clean;
  if (picks.body) s += `|b:${picks.body}`;
  if (picks.eyes) s += `|e:${picks.eyes}`;
  if (picks.colour) s += `|c:${picks.colour}`;
  return s;
}

/** A stored seed, or the default (the slug) when it is missing or malformed. */
export function seedOr(seed: string | null | undefined, slug: string): string {
  return seed && AVATAR_SEED_RE.test(seed) ? seed : slug.toLowerCase();
}

export function avatarFromSeed(seed: string): AvatarSpec {
  const { base, picks } = parseAvatarSeed(seed);
  const r = rng(hash(picks.reroll ? `${base}~${picks.reroll}` : base));
  // Draw every trait even when picked, so a pick never reshuffles the others.
  const body = pick(r, BODIES);
  const bodyW = BODY_W.min + 2 * Math.floor(r() * ((BODY_W.max - BODY_W.min) / 2 + 1));
  const bodyH = BODY_H.min + Math.floor(r() * (BODY_H.max - BODY_H.min + 1));
  const eyes = pick(r, EYES);
  const eyeGap = Math.floor(r() * 3);
  const eyeY = Math.floor(r() * 3) - 1;
  const mouth = pick(r, MOUTHS);
  const accessory = pick(r, ACCESSORIES);
  // Red is the brand accent: it comes up more often than the quiet grounds.
  const colour = pick(r, ["red", "red", "cream", "coral", "ink", "deep"] as const);
  return {
    seed,
    body: picks.body ?? body,
    bodyW,
    bodyH,
    eyes: picks.eyes ?? eyes,
    eyeGap,
    eyeY,
    mouth,
    accessory,
    colour: picks.colour ?? colour,
  };
}

/** Problems with a spec, empty when it is valid. Specs from avatarFromSeed always are; this guards hand-made ones. */
export function validateAvatarSpec(s: unknown): string[] {
  const e: string[] = [];
  if (!s || typeof s !== "object") return ["not an object"];
  const x = s as Record<string, unknown>;
  const int = (k: string, lo: number, hi: number) => {
    const v = x[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) e.push(`${k} must be an integer in ${lo}..${hi}`);
  };
  if (typeof x.seed !== "string" || !x.seed || x.seed.length > SEED_MAX) e.push(`seed must be 1..${SEED_MAX} characters`);
  if (!includes(BODIES, x.body as string)) e.push("body is not a known shape");
  int("bodyW", BODY_W.min, BODY_W.max);
  if (typeof x.bodyW === "number" && x.bodyW % 2) e.push("bodyW must be even");
  int("bodyH", BODY_H.min, BODY_H.max);
  if (!includes(EYES, x.eyes as string)) e.push("eyes is not a known style");
  int("eyeGap", 0, 2);
  int("eyeY", -1, 1);
  if (!includes(MOUTHS, x.mouth as string)) e.push("mouth is not a known style");
  if (!includes(ACCESSORIES, x.accessory as string)) e.push("accessory is not a known primitive");
  if (!includes(COLOURS, x.colour as string)) e.push("colour is not in the brand palette");
  return e;
}

export const isAvatarSpec = (s: unknown): s is AvatarSpec => validateAvatarSpec(s).length === 0;
