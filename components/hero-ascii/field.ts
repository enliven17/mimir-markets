/**
 * ASCII wave field renderer, shared by the worker (OffscreenCanvas) and the
 * main-thread fallback. Glyphs are cream and turn coral at the wave peaks.
 *
 * Every glyph and colour step is drawn once into a small atlas, so a frame is
 * only `drawImage` calls. Per-cell distance is precomputed on resize and the
 * noise term is separable (one sine per column, one cosine per row), so the
 * per-cell work is one sine and a few multiplies.
 */
export type RGB = [number, number, number];

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const CHARS = ".:-=+*#%@";
const ALPHA_STEPS = 6;
const MIX_STEPS = 4;

export interface Field {
  resize(width: number, height: number): void;
  paint(frame: number): void;
}

/** Vignette levels baked into each cell; cells below the first level are skipped. */
const FADE_STEPS = 6;

export function createField(
  canvas: AnyCanvas,
  makeCanvas: (w: number, h: number) => AnyCanvas,
  opts: { dpr: number; base: RGB; peak: RGB },
): Field | null {
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true }) as AnyCtx | null;
  if (!ctx) return null;
  const { dpr, base, peak } = opts;
  // Overall strength, baked in instead of a CSS opacity on the wrapper.
  let gain = 0.55;
  // Per-cell vignette level (0 = skip), baked in instead of a CSS mask so the
  // compositor never re-renders a masked layer on every frame.
  let fade = new Uint8Array(0);

  let cols = 0;
  let rows = 0;
  let cell = 14;
  let cw = 8.4;
  let gw = 0;
  let gh = 0;
  let atlas: AnyCanvas | null = null;
  let dist = new Float32Array(0);
  let colNoise = new Float32Array(0);
  let rowNoise = new Float32Array(0);
  let xs = new Int32Array(0);
  let ys = new Int32Array(0);

  // Atlas: one row per (alpha, mix) step, one column per glyph.
  function buildAtlas(): AnyCanvas | null {
    const a = makeCanvas(gw * CHARS.length, gh * ALPHA_STEPS * MIX_STEPS);
    const g = a.getContext("2d") as AnyCtx | null;
    if (!g) return null;
    g.font = `${cell * dpr}px ui-monospace, monospace`;
    g.textBaseline = "alphabetic";
    for (let ai = 0; ai < ALPHA_STEPS; ai++) {
      for (let mi = 0; mi < MIX_STEPS; mi++) {
        const mix = mi / (MIX_STEPS - 1);
        const alpha = 0.18 + (ai / (ALPHA_STEPS - 1)) * 0.42;
        const r = Math.round(base[0] * (1 - mix) + peak[0] * mix);
        const gg = Math.round(base[1] * (1 - mix) + peak[1] * mix);
        const b = Math.round(base[2] * (1 - mix) + peak[2] * mix);
        g.fillStyle = `rgba(${r}, ${gg}, ${b}, ${alpha})`;
        const row = ai * MIX_STEPS + mi;
        for (let ci = 0; ci < CHARS.length; ci++) g.fillText(CHARS[ci], ci * gw, row * gh + gh * 0.85);
      }
    }
    return a;
  }

  function resize(width: number, height: number) {
    // Bigger cells on phones: fewer glyphs, same texture.
    cell = width < 640 ? 18 : 16;
    gain = width < 640 ? 0.32 : 0.55;
    cw = cell * 0.6;
    gw = Math.ceil(cw * dpr);
    gh = Math.ceil(cell * dpr);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    cols = Math.ceil(width / cw);
    rows = Math.ceil(height / cell);
    dist = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      const cy = y / rows - 0.5;
      for (let x = 0; x < cols; x++) {
        const cx = x / cols - 0.5;
        dist[y * cols + x] = Math.sqrt(cx * cx + cy * cy) * 12;
      }
    }
    // Same shape as the old CSS mask: an ellipse (72% × 62%, centred at 46%
    // down) that is clear inside 18% of its radius and full beyond 78%.
    fade = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      const ey = (y / rows - 0.46) / 0.62;
      for (let x = 0; x < cols; x++) {
        const ex = (x / cols - 0.5) / 0.72;
        const d = Math.sqrt(ex * ex + ey * ey);
        const f = Math.min(1, Math.max(0, (d - 0.18) / 0.6));
        fade[y * cols + x] = Math.round(f * FADE_STEPS);
      }
    }
    colNoise = new Float32Array(cols);
    rowNoise = new Float32Array(rows);
    xs = Int32Array.from({ length: cols }, (_, x) => Math.round(x * cw * dpr));
    ys = Int32Array.from({ length: rows }, (_, y) => Math.round(y * cell * dpr));
    atlas = buildAtlas();
  }

  function paint(frame: number) {
    if (!atlas) return;
    const c = ctx!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const phase = frame * 0.03;
    for (let x = 0; x < cols; x++) colNoise[x] = Math.sin(x * 0.3 + frame * 0.01) * 0.3;
    for (let y = 0; y < rows; y++) rowNoise[y] = Math.cos(y * 0.3 + frame * 0.02);
    const last = CHARS.length - 1;
    let alphaLevel = -1;
    for (let y = 0; y < rows; y++) {
      const rn = rowNoise[y];
      const dy = ys[y];
      const off = y * cols;
      for (let x = 0; x < cols; x++) {
        const level = fade[off + x];
        if (level === 0) continue;
        if (level !== alphaLevel) {
          alphaLevel = level;
          c.globalAlpha = (level / FADE_STEPS) * gain;
        }
        const wave = Math.sin(dist[off + x] - phase) * 0.5 + 0.5;
        let val = wave * 0.7 + colNoise[x] * rn;
        if (val < 0) val = 0;
        else if (val > 1) val = 1;
        const ci = (val * last) | 0;
        const ai = Math.round(val * (ALPHA_STEPS - 1));
        const m = (wave - 0.6) * 2.5;
        const mi = m <= 0 ? 0 : Math.round((m > 1 ? 1 : m) * (MIX_STEPS - 1));
        c.drawImage(atlas, ci * gw, (ai * MIX_STEPS + mi) * gh, gw, gh, xs[x], dy, gw, gh);
      }
    }
  }

  return { resize, paint };
}
