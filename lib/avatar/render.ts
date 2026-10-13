/**
 * Spec + face -> a flat list of primitives on the 32x32 grid. Pure: no DOM, no React, no hooks, so it runs in
 * node:test, in next/og (avatarSvg returns plain SVG markup) and in components/avatar/AgentAvatar.tsx, which maps
 * the same list to elements. Coordinates are whole units wherever the shape allows, for crisp pixels.
 */
// Mimir's colours (app/globals.css). WATER/ACCENT/DOT keep snipad's role names: the accent, a light ground, small marks.
const INK = "#110F0E", WHITE = "#FFFFFF", PAPER = "#D9CDB5", WATER = "#FF2B2B", ACCENT = "#FF5148", DOT = "#FF5148";
const CREAM = "#F3EAD6", DEEP = "#8F0E17", CHARCOAL = "#2E2624", BID = "#9FD6A8", ASK = "#8F0E17";
// A beard on a light (cream, coral) body: a warm tan, never the accent red.
const BEARD_ON_LIGHT = "#9C8664";
import type { AvatarSpec, BodyShape, ColourName } from "./spec";
import { GRID } from "./spec";
import type { EyeShape, Face, MouthShape } from "./face";

export type Part = "shadow" | "accessory" | "body" | "texture" | "eyes" | "brows" | "mouth" | "tint" | "overlay";
type Paint = { fill: string; stroke?: string; opacity?: number; part: Part; cls?: string };
export type Prim =
  | ({ k: "rect"; x: number; y: number; w: number; h: number } & Paint)
  | ({ k: "path"; d: string } & Paint)
  | ({ k: "circle"; cx: number; cy: number; r: number } & Paint);

export interface Colours {
  body: string;
  /** Eyes/mouth drawn straight on the body. */
  feature: string;
  /** Antenna tips, crest. */
  tip: string;
  /** The crosshair reticle (aiming). */
  reticle: string;
  /** Visor glass and its lit pixels. */
  visor: string;
  lit: string;
  /** Dot-screen texture colour and strength. */
  dots: string;
  dotsOpacity: number;
  /** Light grounds show the win/loss tint on the mouth too. */
  light: boolean;
}

export const PALETTE: Record<ColourName, Colours> = {
  red: { body: WATER, feature: CREAM, tip: CREAM, reticle: INK, visor: INK, lit: ACCENT, dots: CREAM, dotsOpacity: 0.25, light: false },
  cream: { body: CREAM, feature: INK, tip: WATER, reticle: INK, visor: INK, lit: DOT, dots: INK, dotsOpacity: 0.12, light: true },
  coral: { body: ACCENT, feature: INK, tip: CREAM, reticle: INK, visor: INK, lit: CREAM, dots: INK, dotsOpacity: 0.14, light: true },
  ink: { body: CHARCOAL, feature: CREAM, tip: WATER, reticle: CREAM, visor: WATER, lit: CREAM, dots: CREAM, dotsOpacity: 0.16, light: false },
  deep: { body: DEEP, feature: CREAM, tip: ACCENT, reticle: CREAM, visor: INK, lit: ACCENT, dots: CREAM, dotsOpacity: 0.2, light: false },
};

/** Corner steps per shape, inset per row from the corner: [topLeft, topRight, bottomRight, bottomLeft]. */
const CORNERS: Record<BodyShape, [number[], number[], number[], number[]]> = {
  block: [[1], [1], [1], [1]],
  squircle: [[2, 1], [2, 1], [2, 1], [2, 1]],
  capsule: [[4, 2, 1, 1], [4, 2, 1, 1], [4, 2, 1, 1], [4, 2, 1, 1]],
  blob: [[4, 2, 1], [2, 1], [3, 1, 1], [1]],
};

/** A stepped outline: rows of [left inset, right inset], merged into one polygon. */
export function bodyPath(shape: BodyShape, x0: number, y0: number, w: number, h: number): string {
  const [tl, tr, br, bl] = CORNERS[shape];
  const rows: [number, number][] = [];
  for (let i = 0; i < h; i++) {
    const fromBottom = h - 1 - i;
    rows.push([Math.max(tl[i] ?? 0, bl[fromBottom] ?? 0), Math.max(tr[i] ?? 0, br[fromBottom] ?? 0)]);
  }
  const pts: [number, number][] = [];
  // Down the right side, then up the left side.
  rows.forEach(([, r], i) => pts.push([x0 + w - r, y0 + i], [x0 + w - r, y0 + i + 1]));
  for (let i = h - 1; i >= 0; i--) pts.push([x0 + rows[i][0], y0 + i + 1], [x0 + rows[i][0], y0 + i]);
  // Drop repeated and collinear points.
  const out: [number, number][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev[0] === last[0] && last[0] === p[0]) || (prev[1] === last[1] && last[1] === p[1]))) out[out.length - 1] = p;
    else out.push(p);
  }
  return `M${out.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
}

type Box = [dx: number, dy: number, w: number, h: number];
const GLYPH: Record<Exclude<EyeShape, "open" | "wide">, Box[]> = {
  squint: [[-2, 0, 4, 1]],
  closed: [[-2, 1, 4, 1]],
  happy: [[-2, 1, 1, 1], [-1, 0, 2, 1], [1, 1, 1, 1]],
  x: [[-2, -1, 1, 1], [-1, 0, 1, 1], [0, 1, 1, 1], [1, 2, 1, 1], [1, -1, 1, 1], [0, 0, 1, 1], [-1, 1, 1, 1], [-2, 2, 1, 1]],
};
const PIXEL_EYE: Record<"open" | "wide", Box> = { open: [-1, -1, 2, 3], wide: [-1, -2, 2, 4] };

const MOUTH: Record<Exclude<MouthShape, "rest">, Box[]> = {
  smile: [[-3, -1, 1, 1], [-2, 0, 4, 1], [2, -1, 1, 1]],
  grin: [[-3, -1, 6, 1], [-2, 0, 4, 1]],
  frown: [[-3, 0, 1, 1], [-2, -1, 4, 1], [2, 0, 1, 1]],
  o: [[-1, -1, 2, 2]],
  flat: [[-3, 0, 6, 1]],
  wavy: [[-3, 0, 1, 1], [-2, -1, 1, 1], [-1, 0, 1, 1], [0, -1, 1, 1], [1, 0, 1, 1], [2, -1, 1, 1]],
};
const REST_MOUTH: Record<AvatarSpec["mouth"], Box[]> = {
  line: [[-2, 0, 4, 1]],
  smile: MOUTH.smile,
  grill: [[-3, -1, 6, 1], [-3, 0, 1, 1], [-1, 0, 2, 1], [2, 0, 1, 1]],
  dot: [[-1, 0, 2, 1]],
};

const BROWS: Record<"focused" | "worried" | "raised", { left: Box[]; right: Box[] }> = {
  focused: { left: [[-2, -4, 2, 1], [0, -3, 1, 1]], right: [[0, -4, 2, 1], [-1, -3, 1, 1]] },
  worried: { left: [[-2, -3, 2, 1], [0, -4, 1, 1]], right: [[0, -3, 2, 1], [-1, -4, 1, 1]] },
  raised: { left: [[-1, -5, 2, 1]], right: [[-1, -5, 2, 1]] },
};

const clampLook = (v: number) => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));

/** Eye centre geometry, shared with the component (it aims the pupils at the pointer). */
export function layout(spec: AvatarSpec, lift = 0) {
  const x0 = (GRID - spec.bodyW) / 2;
  const y1 = 30 + lift;
  const y0 = y1 - spec.bodyH;
  const ey = y0 + Math.round(spec.bodyH * 0.38) + spec.eyeY + (spec.eyes === "cyclops" ? 1 : 0);
  const hs = 3 + spec.eyeGap + (spec.bodyW >= 20 ? 1 : 0);
  const my = y0 + Math.round(spec.bodyH * 0.74);
  return { x0, x1: x0 + spec.bodyW, y0, y1, ey, hs, my, eyesX: spec.eyes === "cyclops" ? [16] : [16 - hs, 16 + hs] };
}

export interface DrawOptions {
  /** id for the dot-screen pattern: unique per SVG on a page. */
  id: string;
}

export interface Drawing {
  prims: Prim[];
  /** The dot-screen pattern the texture prim references. */
  pattern: { id: string; fill: string; opacity: number };
  /** Greyed out (killed). */
  dim: boolean;
}

export function drawAvatar(spec: AvatarSpec, face: Face, { id }: DrawOptions): Drawing {
  const pal = PALETTE[spec.colour];
  const grey = face.tint === "grey";
  const body = grey ? PAPER : pal.body;
  const feature = grey ? INK : pal.feature;
  const L = layout(spec, face.lift);
  const { x0, x1, y0, ey, hs, my } = L;
  const prims: Prim[] = [];
  const box = (b: Box, ox: number, oy: number, fill: string, part: Part, k = 1, extra: Partial<Paint> = {}): Prim => ({ k: "rect", x: ox + b[0] * k, y: oy + b[1] * k, w: b[2] * k, h: b[3] * k, fill, part, ...extra });

  // Ground shadow: shrinks as the body hops.
  const lifted = Math.min(3, Math.max(0, -face.lift));
  prims.push({ k: "rect", x: x0 + 2 + lifted, y: 31, w: spec.bodyW - 4 - 2 * lifted, h: 1, fill: INK, opacity: 0.18, part: "shadow" });

  // Accessories sit behind the body, so its outline covers the joins.
  const tip = grey ? PAPER : pal.tip;
  if (spec.accessory === "horns") {
    // A helm's two horns, curving out and up from the top corners; the right one mirrors the left about x = 16.
    const horn: Box[] = [[0, -2, 3, 2], [-1, -4, 3, 2], [-2, -6, 2, 2], [-2, -8, 1, 2]];
    for (const [dx, dy, w, h] of horn) {
      prims.push({ k: "rect", x: x0 + dx, y: y0 + dy, w, h, fill: grey ? PAPER : CREAM, stroke: INK, part: "accessory" });
      prims.push({ k: "rect", x: 32 - (x0 + dx) - w, y: y0 + dy, w, h, fill: grey ? PAPER : CREAM, stroke: INK, part: "accessory" });
    }
  } else if (spec.accessory === "crest") {
    prims.push({ k: "path", d: `M13 ${y0}V${y0 - 2}H15V${y0 - 4}H17V${y0 - 2}H19V${y0}Z`, fill: tip, stroke: INK, part: "accessory" });
  }

  const outline = bodyPath(spec.body, x0, y0, spec.bodyW, spec.bodyH);
  prims.push({ k: "path", d: outline, fill: body, stroke: INK, part: "body" });
  prims.push({ k: "path", d: outline, fill: `url(#${id})`, part: "texture" });

  // Beard: stepped rows from under the mouth to the chin, narrowing to a point; rune: ᛗ on the forehead.
  if (spec.accessory === "beard") {
    const top = my + 2, rows = 31 - top + 1;
    for (let i = 0; i < rows; i++) {
      const inset = 2 + Math.max(0, i - (rows - 4)) * 2;
      const w = spec.bodyW - 2 * inset;
      if (w > 0) prims.push({ k: "rect", x: x0 + inset, y: top + i, w, h: 1, fill: grey ? PAPER : pal.light ? BEARD_ON_LIGHT : CREAM, part: "accessory" });
    }
  } else if (spec.accessory === "rune") {
    for (const b of [[-2, 0, 1, 3], [2, 0, 1, 3], [-1, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1]] as Box[]) prims.push(box(b, 16, y0 + 1, grey ? INK : tip, "accessory"));
  }

  // Eyes.
  const shapes: readonly [EyeShape, EyeShape] = typeof face.eyes === "string" ? [face.eyes, face.eyes] : face.eyes;
  const lx = clampLook(face.look.x);
  const ly = clampLook(face.look.y);
  if (spec.eyes === "visor") {
    const vx = 16 - hs - 3;
    const vw = 2 * hs + 6;
    prims.push({ k: "rect", x: vx, y: ey - 1, w: vw, h: 4, fill: grey ? PAPER : pal.visor, stroke: INK, part: "eyes" });
    const lit = grey ? INK : pal.lit;
    shapes.forEach((s, i) => {
      const cx = L.eyesX[i];
      if (s === "open" || s === "wide") prims.push({ k: "rect", x: cx - 1 + Math.round(lx), y: ey + (s === "wide" ? -1 : 0) + Math.round(ly * 0.5), w: 2, h: s === "wide" ? 3 : 2, fill: lit, part: "eyes", cls: "av-pupil" });
      else if (s === "closed") prims.push(box([-2, 1, 4, 1], cx, ey, lit, "eyes", 1, { opacity: 0.5 }));
      else for (const b of GLYPH[s]) prims.push(box(b, cx, ey, lit, "eyes"));
    });
  } else {
    const single = spec.eyes === "cyclops";
    const list = single ? [shapes[1]] : shapes; // cyclops: the right (aiming) eye
    const k = single ? 2 : 1;
    list.forEach((s, i) => {
      const cx = L.eyesX[i];
      if ((s === "open" || s === "wide") && (spec.eyes === "round" || single)) {
        const r = (single ? 4 : 2.5) + (s === "wide" ? 0.5 : 0);
        const pr = single ? 2 : 1.2;
        const reach = r - pr - 0.4;
        prims.push({ k: "circle", cx, cy: ey + 0.5, r, fill: WHITE, stroke: INK, part: "eyes" });
        prims.push({ k: "circle", cx: cx + lx * reach, cy: ey + 0.5 + ly * reach, r: pr, fill: INK, part: "eyes", cls: "av-pupil" });
      } else if (s === "open" || s === "wide") {
        prims.push(box(PIXEL_EYE[s], cx + Math.round(lx), ey + Math.round(ly), feature, "eyes", 1, { cls: "av-pupil" }));
      } else {
        for (const b of GLYPH[s]) prims.push(box(b, cx, ey, feature, "eyes", k));
      }
    });
  }

  // Brows.
  if (face.brow !== "none") {
    const b = BROWS[face.brow];
    if (spec.eyes === "cyclops") {
      const y = ey - (face.brow === "raised" ? 8 : face.brow === "worried" ? 6 : 5);
      prims.push({ k: "rect", x: 13, y, w: 6, h: 1, fill: feature, part: "brows" });
    } else {
      const lift = spec.eyes === "visor" ? -1 : 0;
      for (const bx of b.left) prims.push(box(bx, L.eyesX[0], ey + lift, feature, "brows"));
      for (const bx of b.right) prims.push(box(bx, L.eyesX[1], ey + lift, feature, "brows"));
    }
  }

  // Mouth: on light bodies the win/loss tint colours it too.
  const tintColour = face.tint === "bid" ? BID : face.tint === "ask" ? ASK : null;
  const mouthColour = tintColour && pal.light ? tintColour : feature;
  for (const b of face.mouth === "rest" ? REST_MOUTH[spec.mouth] : MOUTH[face.mouth]) prims.push(box(b, 16, my, mouthColour, "mouth"));

  // Tint mark: a small square, like a status dot.
  if (tintColour) prims.push({ k: "rect", x: x1 - 5, y: y0 + 2, w: 3, h: 3, fill: tintColour, stroke: INK, part: "tint" });

  // Overlays.
  const right = Math.min(29, x1);
  const top = Math.max(1, y0);
  if (face.overlay === "reticle") {
    const cx = spec.eyes === "cyclops" ? 16 : L.eyesX[1];
    const c = grey ? INK : pal.reticle;
    const g = spec.eyes === "cyclops" ? 2 : 0;
    for (const b of [[-1, -5 - g, 2, 3], [-1, 4 + g, 2, 3], [-6 - g, 0, 3, 2], [3 + g, 0, 3, 2]] as Box[]) prims.push(box(b, cx, ey, c, "overlay", 1, { cls: "av-reticle" }));
  } else if (face.overlay === "dots") {
    prims.push({ k: "rect", x: right - 2, y: top + 1, w: 1, h: 1, fill: INK, part: "overlay", cls: "av-dot av-dot-1" });
    prims.push({ k: "rect", x: right, y: Math.max(0, top - 2), w: 2, h: 2, fill: INK, part: "overlay", cls: "av-dot av-dot-2" });
    prims.push({ k: "rect", x: Math.min(29, right + 1), y: Math.max(0, top - 6), w: 3, h: 3, fill: INK, part: "overlay", cls: "av-dot av-dot-3" });
  } else if (face.overlay === "zzz") {
    const z = (zx: number, zy: number, cls: string) => {
      for (const b of [[0, 0, 3, 1], [1, 1, 1, 1], [0, 2, 3, 1]] as Box[]) prims.push(box(b, zx, zy, INK, "overlay", 1, { opacity: 0.75, cls }));
    };
    z(Math.min(26, right - 2), Math.max(0, top - 4), "av-z av-z-1");
    z(Math.min(29, right + 1), Math.max(0, top - 8), "av-z av-z-2");
  } else if (face.overlay === "sparkle") {
    const plus = (px: number, py: number, cls: string) => {
      for (const b of [[1, 0, 1, 3], [0, 1, 3, 1]] as Box[]) prims.push(box(b, px, py, WATER, "overlay", 1, { cls }));
    };
    plus(Math.max(0, x0 - 4), top + 1, "av-spark av-spark-1");
    plus(Math.min(29, right + 1), Math.max(0, top - 3), "av-spark av-spark-2");
  } else if (face.overlay === "sweat") {
    prims.push({ k: "rect", x: x1 - 4, y: y0 + 2, w: 2, h: 3, fill: ACCENT, stroke: INK, part: "overlay", cls: "av-sweat" });
  }

  return { prims, pattern: { id, fill: pal.dots, opacity: pal.dotsOpacity }, dim: grey };
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** Outline width in grid units for a given rendered size: 1 px up to 64 px, 2 px above (as the share cards do). */
export const lineUnits = (size: number) => ((size > 64 ? 2 : 1) * GRID) / size;

/**
 * The avatar as standalone SVG markup, for next/og (`<img src={dataUri}>`) and anywhere without React.
 * `size` is the rendered pixel size (sets width/height and the outline width).
 */
export function avatarSvg(spec: AvatarSpec, face: Face, { size = 96, id = "av" }: { size?: number; id?: string } = {}): string {
  const d = drawAvatar(spec, face, { id: `${id}-dots` });
  const sw = n(lineUnits(size));
  const attrs = (p: Prim) => `fill="${p.fill}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${sw}"` : ""}${p.opacity !== undefined ? ` opacity="${p.opacity}"` : ""}`;
  const body = d.prims
    .map((p) =>
      p.k === "rect"
        ? `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" ${attrs(p)}/>`
        : p.k === "circle"
          ? `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.r)}" ${attrs(p)} shape-rendering="geometricPrecision"/>`
          : `<path d="${p.d}" ${attrs(p)}/>`,
    )
    .join("");
  const pattern = `<pattern id="${d.pattern.id}" width="2" height="2" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.34" fill="${d.pattern.fill}" fill-opacity="${d.pattern.opacity}"/></pattern>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges"><defs>${pattern}</defs><g${d.dim ? ' opacity="0.6"' : ""}>${body}</g></svg>`;
}

/** avatarSvg as a data URI, the form next/og's <img> takes. */
export function avatarDataUri(spec: AvatarSpec, face: Face, opts?: { size?: number; id?: string }): string {
  const svg = avatarSvg(spec, face, opts);
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(svg).toString("base64") : btoa(svg);
  return `data:image/svg+xml;base64,${b64}`;
}
