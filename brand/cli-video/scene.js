// "Mimir CLI is coming" (18 s, 120 BPM, bar = 2 s, step = 125 ms), 16:9. The hook slams the line, then one terminal
// window plays the real CLI: install and run (the real banner and welcome box), `markets` (live devnet rows), then
// `agent add` and `ask` (your own agent on your own AI), and the end card with the install line.
// Every glyph and colour in the window comes from cli-output.js, captured from cli/bin/mimir.mjs with a fake TTY.
// Illustrations: the npm line (the package is not published yet), the reply's words (a stand-in for the local AI).
// Same system as ../daily-02-video (helpers copied from it).
import { TAU, prog, rgba, E, EASE, spring, setFont, clamp, lerp, shake, vignette, rrect } from '../../engine/core.js';
import CLI from './cli-output.js';

// ── tokens (app/globals.css)
const INK = [17, 15, 14], INK_DEEP = [10, 8, 8], PANEL2 = [39, 33, 32], CREAM = [243, 234, 214], MUTED = [168, 157, 147];
const DIM = [146, 135, 128], RED = [255, 43, 43], CORAL = [255, 81, 72], WIN = [159, 214, 168], PENDING = [255, 179, 173];
const GLASS_CARD = 'rgba(28,20,21,0.93)';
const DISPLAY = "'Terminal Grotesque'", PIXEL = "'Geist Pixel Square'", MONO = "'Geist Mono'";

// ── copy
const COPY = {
  en: {
    hook: ['Mimir CLI', 'is coming.'],
    caps: [['The terminal,', '*in your shell.'], ['Live markets.', '*No browser.'], ['Your agents.', '*Your AI.']],
    end: ['Coming to', 'your shell.'], install: 'npm i -g mimir-terminal', url: 'mimirmarkets.xyz',
  },
};

// ── beat grid (sound.py mirrors these)
const T = {};
function times(at) {
  Object.assign(T, {
    H1: at(0, 1), H2: at(0, 6), SCRIB: at(0, 10), H_OUT: at(1, 6),
    WIN: at(1, 8), A: at(1, 10), A_OUT: at(2, 3), A_RUN: at(2, 5), BAN: at(2, 8),
    B: at(3, 6), B_TYPE: at(3, 7), ROWS: at(3, 12),
    C: at(4, 10), C_ADD: at(4, 11), SAVED: at(5, 7), ASK: at(5, 9), THINK: at(6, 1), REPLY: at(6, 4),
    END: at(7, 6), HORN: at(7, 8), MAIN: at(7, 11), SCRIB2: at(7, 15), INSTALL: at(8, 1), URL: at(8, 3),
  });
}
// ── images
const img = {};
const loadImg = src => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error(`image ${src}`)); i.src = src; });

// ── ordered dither (useDitherReveal: 8×8 Bayer, stepped from empty to solid)
function bayer(n) {
  if (n === 1) return [[0]];
  const m = bayer(n / 2), out = [];
  for (let y = 0; y < n; y++) {
    out.push([]);
    for (let x = 0; x < n; x++) out[y].push(m[y % (n / 2)][x % (n / 2)] * 4 + [[0, 2], [3, 1]][y < n / 2 ? 0 : 1][x < n / 2 ? 0 : 1]);
  }
  return out;
}
const B8 = bayer(8), maskTiles = new Map();
let bctx, b2ctx;
function tiles(ctx, cell) {
  if (maskTiles.has(cell)) return maskTiles.get(cell);
  const list = [];
  for (let lvl = 0; lvl <= 64; lvl++) {
    const c = document.createElement('canvas'); c.width = c.height = cell * 8;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (B8[y][x] < lvl) g.fillRect(x * cell, y * cell, cell, cell);
    list.push(ctx.createPattern(c, 'repeat'));
  }
  maskTiles.set(cell, list);
  return list;
}
function fresh(c) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.letterSpacing = '0px'; c.clearRect(0, 0, c.canvas.width, c.canvas.height); }
/** Draw `fn` through a dither mask at level p (0 = empty, 1 = solid), rising `rise` px as it arrives. */
function dither(ctx, p, fn, { cell = 7, rise = 36, second = false } = {}) {
  if (p <= 0) return;
  if (p >= 1) { fn(ctx); return; }
  const c = second ? b2ctx : bctx;
  fresh(c);
  c.translate(0, (1 - EASE.expo(p)) * rise);
  fn(c);
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
  c.globalCompositeOperation = 'destination-in';
  c.fillStyle = tiles(ctx, cell)[Math.round(clamp(p) * 64)];
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  c.globalCompositeOperation = 'source-over';
  ctx.drawImage(c.canvas, 0, 0);
}
/** In over [a, a+din], out over [b, b+dout]: a dither level. */
const life = (t, a, din, b = Infinity, dout = 0.3) => Math.min(prog(t, a, a + din), 1 - prog(t, b, b + dout));

// ── ASCII wave field (components/hero-ascii/field.ts, atlas and all)
const CHARS = '.:-=+*#%@', A_STEPS = 6, M_STEPS = 4;
let F;
function buildField(W, H, cell = 16) {
  const cw = cell * 0.6, gw = Math.ceil(cw), gh = Math.ceil(cell);
  const atlas = document.createElement('canvas'); atlas.width = gw * CHARS.length; atlas.height = gh * A_STEPS * M_STEPS;
  const g = atlas.getContext('2d');
  g.font = `${cell}px ui-monospace, Consolas, monospace`; g.textBaseline = 'alphabetic';
  for (let ai = 0; ai < A_STEPS; ai++) for (let mi = 0; mi < M_STEPS; mi++) {
    const mx = mi / (M_STEPS - 1), a = 0.18 + (ai / (A_STEPS - 1)) * 0.42;
    g.fillStyle = rgba(CREAM.map((b, i) => b * (1 - mx) + CORAL[i] * mx), a);
    for (let ci = 0; ci < CHARS.length; ci++) g.fillText(CHARS[ci], ci * gw, (ai * M_STEPS + mi) * gh + gh * 0.85);
  }
  const cols = Math.ceil(W / cw), rows = Math.ceil(H / cell);
  const dist = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const dx = x / cols - 0.5, dy = y / rows - 0.5;
    dist[y * cols + x] = Math.sqrt(dx * dx + dy * dy) * 12;
  }
  F = { atlas, cols, rows, cw, cell, gw, gh, dist, xs: Array.from({ length: cols }, (_, x) => Math.round(x * cw)), ys: Array.from({ length: rows }, (_, y) => Math.round(y * cell)) };
}
/** mask(u, v) → 0..1 per cell; gain is the overall strength. frame = the site's 24 fps frame counter. */
function field(ctx, frame, gain, mask) {
  if (gain <= 0.005) return;
  const { atlas, cols, rows, gw, gh, dist, xs, ys } = F, last = CHARS.length - 1, phase = frame * 0.03;
  ctx.save();
  for (let y = 0; y < rows; y++) {
    const rn = Math.cos(y * 0.3 + frame * 0.02);
    for (let x = 0; x < cols; x++) {
      const f = mask(x / cols, y / rows);
      if (f <= 0.02) continue;
      const wave = Math.sin(dist[y * cols + x] - phase) * 0.5 + 0.5;
      const val = clamp(wave * 0.7 + Math.sin(x * 0.3 + frame * 0.01) * 0.3 * rn);
      const m = (wave - 0.6) * 2.5, mi = m <= 0 ? 0 : Math.round(Math.min(1, m) * (M_STEPS - 1));
      ctx.globalAlpha = Math.round(f * 6) / 6 * gain;
      ctx.drawImage(atlas, ((val * last) | 0) * gw, (Math.round(val * (A_STEPS - 1)) * M_STEPS + mi) * gh, gw, gh, xs[x], ys[y], gw, gh);
    }
  }
  ctx.restore();
}
/** The hero's mask: clear in the middle ellipse, full towards the edges. */
const heroMask = (u, v) => { const ex = (u - 0.5) / 0.72, ey = (v - 0.46) / 0.62; return clamp((Math.hypot(ex, ey) - 0.18) / 0.6); };
/** The end card's mask: a soft hole around the horn. */
const endMask = (u, v) => { const d = Math.hypot(u - 0.5, v - 0.4) / 1.1; return d < 0.2 ? d / 0.2 * 0.4 : clamp(1 - (d - 0.2) / 0.5); };

// ── pixel scribble (Scribble.tsx: same seed, same strokes)
function scribblePts(cols, rows) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pts = [], plot = (x, y) => pts.push([Math.round(x), Math.round(y)]);
  for (let x = 1; x < cols - 2; x += 0.5) plot(x, rows * 0.36 + Math.sin((x / cols) * Math.PI * 1.6 + 0.4) * rows * 0.05 + (rnd() - 0.5) * 0.5);
  for (let k = 0; k < 1; k += 0.05) plot(cols - 2 - k * 3, rows * 0.36 + k * rows * 0.26);
  for (let x = cols - 5; x > cols * 0.06; x -= 0.5) plot(x, rows * 0.62 + Math.sin((x / cols) * Math.PI * 1.3 + 2) * rows * 0.05 + (rnd() - 0.5) * 0.5);
  return pts;
}
/** Under the accent word: box left -5%, top 82% of the line, width 110%, height 0.42em; drawn in over 650 ms. */
function scribble(c, x, base, wordW, fs, p) {
  if (p <= 0) return;
  const px = Math.max(2, Math.round(fs * 0.032)), bw = wordW * 1.1, bh = fs * 0.42;
  const cols = Math.max(8, Math.floor(bw / px)), rows = Math.max(4, Math.floor(bh / px));
  const pts = scribblePts(cols, rows), n = Math.floor(pts.length * clamp(p));
  const x0 = x - wordW * 0.05, y0 = base + fs * 0.03, sx = bw / cols, sy = bh / rows;
  for (let i = 0; i < n; i++) {
    const [gx, gy] = pts[i];
    c.fillStyle = i % 7 === 0 ? '#ff5148' : '#ff2b2b';
    c.fillRect(Math.round(x0 + gx * sx), Math.round(y0 + gy * sy), Math.ceil(sx), Math.ceil(sy * (i % 4 === 0 ? 2 : 1)));
  }
}

// ── type
function font(c, px, fam = DISPLAY, w = 400, tr = 0) { setFont(c, w, px, fam, tr); }
function text(c, s, x, y, col, a = 1) { c.fillStyle = rgba(col, a); c.fillText(s, x, y); }
function width(c, s) { return c.measureText(s).width; }
const display = (c, fs) => font(c, fs, DISPLAY, 400, -0.01 * fs);
/** The largest display size up to `cap` at which every line fits in maxW. */
function fitSize(c, lines, maxW, cap) {
  display(c, cap);
  const w = Math.max(...lines.map(l => width(c, l)));
  return w > maxW ? Math.floor(cap * maxW / w) : cap;
}
/** A display line; trailing punctuation in red, the whole line in red when col is RED. Left-aligned at x. */
function line(c, s, x, y, col, a = 1) {
  c.textAlign = 'left';
  const end = /[.,?]$/.test(s) && col !== RED ? s.length - 1 : s.length;
  text(c, s.slice(0, end), x, y, col, a);
  if (end < s.length) text(c, s.slice(end), x + width(c, s.slice(0, end)), y, RED, a);
}
function lineC(c, s, cx, y, col, a = 1) { line(c, s, cx - width(c, s) / 2, y, col, a); }
/** One line, the accent word in red with the scribble under it, centred on cx. */
function slogan(c, cx, base, fs, scribP, lead, accent) {
  display(c, fs);
  const L = lead + ' ', A = accent, wl = width(c, L), wa = width(c, A), x0 = cx - (wl + wa) / 2;
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  text(c, L, x0, base, CREAM); text(c, A, x0 + wl, base, RED);
  scribble(c, x0 + wl, base, wa, fs, scribP);
}

/** A number that rolls digit by digit when it changes (RollingNumber, with the red flash). */
function rolling(c, events, t, x, y, { size = 36, col = CREAM, align = 'left', fam = MONO, flash = true } = {}) {
  let i = 0;
  while (i + 1 < events.length && t >= events[i + 1][0]) i++;
  const [t0, cur] = events[i], prev = i > 0 ? events[i - 1][1] : cur;
  const p = i > 0 ? EASE.expo(prog(t, t0, t0 + 0.42)) : 1;
  font(c, size, fam, 500);
  const cwid = width(c, '0'), n = Math.max(cur.length, prev.length);
  const a = cur.padStart(n, ' '), b = prev.padStart(n, ' ');
  const total = [...a].reduce((s, ch) => s + (/[0-9]/.test(ch) ? cwid : width(c, ch)), 0);
  let xx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const fl = flash && i > 0 ? 1 - prog(t, t0, t0 + 0.7) : 0;
  const colr = [0, 1, 2].map(k => lerp(col[k], CORAL[k], fl));
  c.save(); c.beginPath(); c.rect(xx - 4, y - size * 1.0, total + 8, size * 1.28); c.clip();
  c.textAlign = 'left';
  for (let k = 0; k < n; k++) {
    const w = /[0-9]/.test(a[k]) ? cwid : width(c, a[k]);
    if (a[k] === b[k] || p >= 1) text(c, a[k], xx, y, colr);
    else { text(c, b[k], xx, y - p * size * 1.15, colr, 1 - p); text(c, a[k], xx, y + (1 - p) * size * 1.15, colr); }
    xx += w;
  }
  c.restore();
  return total;
}

// ── shapes
function card(c, x, y, w, h, r = 22, fill = GLASS_CARD) {
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 60; c.shadowOffsetY = 24;
  rrect(c, x, y, w, h, r); c.fillStyle = fill; c.fill();
  c.restore();
  c.save(); rrect(c, x, y, w, h, r); c.clip();
  c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + r, y + 1); c.lineTo(x + w - r, y + 1); c.stroke();
  c.restore();
}
function dot(c, x, y, r, col, glow = 0) {
  c.save();
  if (glow) { c.shadowColor = rgba(col, 0.58); c.shadowBlur = glow; }
  c.fillStyle = rgba(col); c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.restore();
}
function avatar(c, im, x, y, d, k = 1) {
  if (k <= 0) return;
  c.save(); c.translate(x, y); c.scale(k, k);
  const g = c.createLinearGradient(-d / 2, -d / 2, d / 2, d / 2); g.addColorStop(0, '#5b3637'); g.addColorStop(1, '#362223');
  c.beginPath(); c.arc(0, 0, d / 2, 0, TAU); c.fillStyle = g; c.fill();
  c.save(); c.clip(); if (im) c.drawImage(im, -d / 2, -d / 2, d, d); c.restore();
  c.lineWidth = 2; c.strokeStyle = 'rgba(243,234,214,0.14)'; c.beginPath(); c.arc(0, 0, d / 2, 0, TAU); c.stroke();
  c.restore();
}
function pill(c, x, y, label, { fg = PENDING, bg = RED, bga = 0.14, size = 24, fam = PIXEL, dotCol = null, align = 'left' } = {}) {
  font(c, size, fam, 500);
  const w = width(c, label) + (dotCol ? size * 1.9 : size * 1.2), h = size * 1.7, x0 = align === 'right' ? x - w : x;
  rrect(c, x0, y - h / 2, w, h, h / 2); c.fillStyle = rgba(bg, bga); c.fill();
  if (dotCol) dot(c, x0 + size * 0.85, y, size * 0.22, dotCol, 8);
  c.textAlign = 'left'; c.textBaseline = 'middle'; text(c, label, x0 + (dotCol ? size * 1.4 : size * 0.6), y + 1, fg);
  c.textBaseline = 'alphabetic';
  return w;
}
function hatch(c, x, y, w, h) {
  c.save(); rrect(c, x, y, w, h, 3); c.clip();
  c.strokeStyle = 'rgba(243,234,214,0.28)'; c.lineWidth = 5;
  for (let k = -h; k < w + h; k += 14) { c.beginPath(); c.moveTo(x + k, y + h); c.lineTo(x + k + h, y); c.stroke(); }
  c.restore();
}
/** A glass well with an eyebrow and a right-hand note. */
function well(c, x, y, w, h, eyebrow, note, noteCol = MUTED) {
  card(c, x, y, w, h, 22, 'rgba(16,10,11,0.95)');
  const pad = 40;
  dot(c, x + pad + 6, y + 50 - 9, 6, RED);
  font(c, 26, PIXEL, 500, 1.3); c.textAlign = 'left'; text(c, eyebrow.toUpperCase(), x + pad + 24, y + 50, RED);
  if (note) { font(c, 28, MONO); c.textAlign = 'right'; text(c, note, x + w - pad, y + 50, noteCol); c.textAlign = 'left'; }
}

/** A gate result: "checking…" until t0, then a green pass that springs in. Right-aligned at (x, y). */
function gate(c, t, x, y, t0, label, size = 26) {
  if (t < t0) { pill(c, x, y, 'checking…', { fg: PENDING, bg: PENDING, bga: 0.1, size, align: 'right' }); return; }
  const k = clamp(spring(t - t0, 16, 8), 0, 1.2);
  c.save(); c.translate(x, y); c.scale(k, k);
  pill(c, 0, 0, `✓ ${label}`, { fg: WIN, bg: WIN, bga: 0.14, size, align: 'right' });
  c.restore();
  const rp = prog(t, t0, t0 + 0.5);
  if (rp < 1) { c.save(); c.globalAlpha = (1 - rp) * 0.5; c.strokeStyle = rgba(WIN); c.lineWidth = 3; c.beginPath(); c.arc(x - 90, y, 24 + rp * 180, 0, TAU); c.stroke(); c.restore(); }
}

// ── the terminal: a window that plays a script of typed commands and printed output
const TERM = { fs: 25, lh: 36, pad: 34, bar: 52 };
const ADD = 'agent add bull prompt You are a crypto bull who loves a cheap dip';
const ASK = 'ask bull is #69 worth a challenge?';
const P = [[`mimir› `, '#ff5f5f', false, false]];
/** One screen of the script: typed lines and printed lines, each with its time. Cleared at `from`. */
function scriptAt(t) {
  const L = [];
  const typed = (at, prompt, cmd, cps = 46) => L.push({ at, prompt, cmd, cps });
  const out = (at, runs) => L.push({ at, runs });
  if (t < T.B) {
    typed(T.A, [['~ $ ', '#a89d93', false, false]], 'npm i -g mimir-terminal', 44);
    out(T.A_OUT, [['added 1 package in 2s', null, false, true]]);
    typed(T.A_RUN, [['~ $ ', '#a89d93', false, false]], 'mimir', 30);
    CLI.banner.forEach((r, i) => out(T.BAN + i * 0.04, r));
  } else if (t < T.C) {
    typed(T.B_TYPE, P, 'markets', 40);
    CLI.markets.forEach((r, i) => out(T.ROWS + i * 0.125, r));
    out(T.ROWS + 0.45, CLI.hint);
  } else {
    typed(T.C_ADD, P, ADD, 58);
    CLI.saved.forEach((r, i) => out(T.SAVED + i * 0.06, r));
    typed(T.ASK, P, ASK, 52);
    // the CLI writes this status and erases it (a carriage return) when the reply arrives
    if (t < T.REPLY) out(T.THINK, [['bull is thinking…', null, false, true]]);
    L.push({ at: T.REPLY, reply: true });
  }
  return L;
}
function runFont(c, bold) { font(c, TERM.fs, MONO, bold ? 700 : 450); }
/** Draw runs from (x, y), `n` characters at most (Infinity = all). Returns the x after them. */
function drawRuns(c, runs, x, y, n = Infinity, cw) {
  let left = n;
  for (const [s, col, bold, dim] of runs) {
    if (left <= 0) break;
    const part = [...s].slice(0, left);
    left -= part.length;
    runFont(c, bold);
    c.fillStyle = col ?? rgba(CREAM);
    c.globalAlpha = dim ? 0.55 : 1;
    // one cell per character, like a terminal grid. Blocks and the box rule fill their cell edge to edge,
    // as a terminal draws them, instead of as font glyphs with gaps between them.
    const top = y - TERM.lh * 0.74, lh = TERM.lh;
    for (const ch of part) {
      if (ch === '█') c.fillRect(x, top, cw + 0.5, lh + 0.5);
      else if (ch === '▀') c.fillRect(x, top, cw + 0.5, lh / 2 + 0.5);
      else if (ch === '▄') c.fillRect(x, top + lh / 2, cw + 0.5, lh / 2 + 0.5);
      else if (ch === '─') c.fillRect(x, top + lh / 2 - 1, cw + 0.5, 2);
      else if (ch === '│') c.fillRect(x + cw / 2 - 1, top, 2, lh + 0.5);
      else c.fillText(ch, x, y);
      x += cw;
    }
    c.globalAlpha = 1;
  }
  return x;
}
/** Word-wrapped lines of at most `cols` characters. */
function wrap(text, cols) {
  const out = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if (cur && (cur + ' ' + w).length > cols) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}
function terminal(c, t, x, y, w, h) {
  // window
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.65)'; c.shadowBlur = 80; c.shadowOffsetY = 30;
  rrect(c, x, y, w, h, 18); c.fillStyle = '#0b0909'; c.fill();
  c.restore();
  c.save(); rrect(c, x, y, w, h, 18); c.clip();
  c.fillStyle = '#171312'; c.fillRect(x, y, w, TERM.bar);
  c.fillStyle = 'rgba(243,234,214,0.08)'; c.fillRect(x, y + TERM.bar, w, 1);
  [[255, 95, 87], [254, 188, 46], [40, 200, 64]].forEach((col, i) => dot(c, x + 28 + i * 24, y + TERM.bar / 2, 7, col));
  font(c, 18, MONO, 500); c.textAlign = 'center'; text(c, t < T.A_RUN + 0.3 ? '~ — zsh' : '~ — mimir', x + w / 2, y + TERM.bar / 2 + 6, MUTED); c.textAlign = 'left';
  // body
  runFont(c, false);
  const cw = c.measureText('M').width, cols = Math.floor((w - TERM.pad * 2) / cw);
  const rows = [];
  for (const it of scriptAt(t)) {
    if (t < it.at) continue;
    if (it.cmd !== undefined) {
      const n = clamp(Math.floor((t - it.at) * it.cps), 0, it.cmd.length);
      rows.push({ runs: [...it.prompt, [it.cmd, null, true, false]], n: it.prompt[0][0].length + n, caret: n < it.cmd.length || t < it.at + it.cmd.length / it.cps + 0.15 });
    } else if (it.reply) {
      const k = Math.floor(clamp((t - it.at) / 1.3) * CLI.replyText.length);
      rows.push({ runs: [['│ ', '#ff5f5f', false, false], ['bull', null, false, true]] });
      // each line with the CLI's red rule, as it prints a reply that has line breaks
      let before = 0;
      wrap(CLI.replyText, cols - 4).forEach((ln) => {
        const shown = Math.min(ln.length, k - before);
        before += ln.length + 1;
        if (shown <= 0) return;
        rows.push({ runs: [['│ ', '#ff5f5f', false, false], [ln, '#f3ead6', false, false]], n: 2 + shown });
      });
    } else rows.push({ runs: it.runs });
  }
  const maxRows = Math.floor((h - TERM.bar - TERM.pad * 2) / TERM.lh);
  const vis = rows.slice(Math.max(0, rows.length - maxRows));
  vis.forEach((r, i) => {
    const ly = y + TERM.bar + TERM.pad + TERM.lh * (i + 0.8);
    const ex = drawRuns(c, r.runs, x + TERM.pad, ly, r.n ?? Infinity, cw);
    if (r.caret && Math.floor(t * 4) % 2 === 0) { c.fillStyle = rgba(CORAL); c.fillRect(ex + 2, ly - TERM.fs * 0.82, cw * 0.9, TERM.fs * 1.02); }
  });
  c.restore();
  c.save(); rrect(c, x + 0.5, y + 0.5, w - 1, h - 1, 18); c.strokeStyle = 'rgba(243,234,214,0.1)'; c.lineWidth = 1; c.stroke(); c.restore();
}

// ── the caption above the window: two words on the left, the red second line
function caption(c, t, lines, t0, t1, x, y) {
  const p = life(t, t0, 0.25, t1, 0.2);
  if (p <= 0) return;
  dither(c, p, g => {
    display(g, 64);
    g.textAlign = 'left';
    const a = lines[0], b = lines[1].replace(/^\*/, '');
    const k = clamp(spring(t - t0, 16, 8), 0, 1.15);
    g.save(); g.translate(x, y); g.scale(lerp(1.1, 1, k), lerp(1.1, 1, k));
    line(g, a, 0, 0, CREAM); line(g, b, width(g, `${a} `), 0, RED);
    g.restore();
  }, { cell: 5, rise: 18, second: true });
}

export default {
  async setup(api) {
    times(api.at.bind(api));
    const { W, H } = api;
    for (const k of ['a', 'b']) {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: api.render });
      if (k === 'a') bctx = g; else b2ctx = g;
    }
    buildField(W, H, 16);
    const base = import.meta.url.replace(/scene\.js.*$/, '');
    img.horn = await loadImg(`${base}horn.svg`);
  },

  draw(ctx, t, api) {
    const { W, H } = api, C = COPY[api.lang] ?? COPY.en;
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, rgba(INK)); bg.addColorStop(1, rgba(INK_DEEP));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const frame = t * 24;
    const [sx, sy] = shake(t, [[T.H1 + 0.03, 7], [T.H2 + 0.03, 9], [T.BAN, 4], [T.MAIN, 8]]);
    ctx.save(); ctx.translate(sx, sy);

    const heroField = prog(t, 0, 0.3) * (1 - prog(t, T.H_OUT, T.WIN + 0.3));
    if (heroField > 0) field(ctx, frame, 0.9 * heroField, heroMask);
    const sideField = prog(t, T.WIN, T.WIN + 0.6) * (1 - prog(t, T.END - 0.3, T.END));
    if (sideField > 0) field(ctx, frame, 0.3 * sideField, (u, v) => clamp((v - 0.9) / 0.1) + clamp((0.06 - u) / 0.06));
    const endField = prog(t, T.END + 0.05, T.HORN + 0.6);
    if (endField > 0) field(ctx, frame, 0.55 * endField, endMask);

    // ── hook: "Mimir CLI / is coming." with the scribble under "coming."
    const hp = life(t, T.H1, 0.18, T.H_OUT, 0.2);
    if (hp > 0) dither(ctx, hp, c => {
      const fs = fitSize(c, [C.hook[0]], W - 300, 230);
      const k1 = clamp(spring(t - T.H1, 18, 9), 0, 1.2);
      c.save(); c.translate(W / 2, H * 0.47); c.scale(lerp(1.4, 1, k1), lerp(1.4, 1, k1));
      display(c, fs); lineC(c, C.hook[0], 0, 0, CREAM); c.restore();
      if (t >= T.H2) {
        const k2 = clamp(spring(t - T.H2, 18, 9), 0, 1.2);
        c.save(); c.translate(W / 2, H * 0.47 + fs * 0.95); c.scale(lerp(1.4, 1, k2), lerp(1.4, 1, k2)); c.globalAlpha = clamp((t - T.H2) / 0.06);
        slogan(c, 0, 0, fs * 0.62, prog(t, T.SCRIB, T.SCRIB + 0.45), 'is', 'coming.');
        c.restore();
      }
    }, { cell: 9, rise: 20 });

    // ── the window, with a caption per scene
    const wp = life(t, T.WIN, 0.3, T.END, 0.25);
    if (wp > 0) {
      const ww = 1730, wh = 800, wx = (W - ww) / 2, wy = 206;
      const k = clamp(spring(t - T.WIN, 12, 8), 0, 1.1), push = 1 + 0.025 * prog(t, T.WIN, T.END);
      dither(ctx, wp, c => {
        c.save(); c.translate(W / 2, wy + wh / 2); c.scale(lerp(0.88, 1, k) * push, lerp(0.88, 1, k) * push); c.translate(-W / 2, -(wy + wh / 2) + (1 - Math.min(1, k)) * 80);
        terminal(c, t, wx, wy, ww, wh);
        c.restore();
      }, { cell: 7, rise: 0 });
      // a flash on each clear
      for (const at of [T.B, T.C]) { const f = 1 - prog(t, at, at + 0.25); if (t >= at && f > 0) { ctx.fillStyle = rgba(CORAL, 0.06 * f); ctx.fillRect(wx, wy, ww, wh); } }
      caption(ctx, t, C.caps[0], T.A, T.B - 0.15, wx + 6, 150);
      caption(ctx, t, C.caps[1], T.B + 0.05, T.C - 0.15, wx + 6, 150);
      caption(ctx, t, C.caps[2], T.C + 0.05, T.END - 0.1, wx + 6, 150);
    }

    // ── end card: the horn, "Coming to your shell." with the scribble, the install line, the URL
    if (t >= T.END) {
      const hp2 = prog(t, T.HORN, T.HORN + 0.5), hs = 360, hx = W / 2, hy = H * 0.32;
      const glow = EASE.expo(prog(t, T.HORN, T.HORN + 1));
      if (glow > 0) {
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hs * 1.15);
        g.addColorStop(0, `rgba(255,43,43,${0.32 * glow})`); g.addColorStop(0.55, `rgba(143,14,23,${0.14 * glow})`); g.addColorStop(1, 'rgba(17,15,14,0)');
        ctx.fillStyle = g; ctx.fillRect(hx - hs * 1.2, hy - hs * 1.2, hs * 2.4, hs * 2.4);
      }
      const drift = Math.sin((t - T.HORN) * 1.3) * 5;
      dither(ctx, hp2, c => {
        const hh = hs, hw = hh * (1148 / 1256);
        c.save(); c.shadowColor = 'rgba(255,43,43,0.35)'; c.shadowBlur = 40;
        c.drawImage(img.horn, hx - hw / 2, hy - hh / 2 + drift, hw, hh); c.restore();
      }, { cell: 8, rise: 40 });
      const base = H * 0.72, fs = fitSize(ctx, [C.end.join(' ')], W - 240, 160);
      const k = clamp(spring(t - T.MAIN, 15, 8), 0, 1.15);
      dither(ctx, prog(t, T.MAIN, T.MAIN + 0.3), c => {
        c.save(); c.translate(W / 2, base); c.scale(lerp(1.2, 1, k), lerp(1.2, 1, k));
        slogan(c, 0, 0, fs, prog(t, T.SCRIB2, T.SCRIB2 + 0.45), C.end[0], C.end[1]);
        c.restore();
      }, { cell: 8, rise: 30 });
      if (t >= T.INSTALL) {
        const n = Math.ceil(C.install.length * prog(t, T.INSTALL, T.INSTALL + 0.45));
        font(ctx, 40, MONO, 600); ctx.textAlign = 'left';
        const full = `$ ${C.install}`, wFull = width(ctx, full), x0 = W / 2 - wFull / 2, y0 = base + fs * 0.62 + 40;
        rrect(ctx, x0 - 28, y0 - 46, wFull + 56, 66, 14); ctx.fillStyle = 'rgba(28,20,21,0.9)'; ctx.fill();
        text(ctx, '$ ', x0, y0, MUTED); text(ctx, C.install.slice(0, n), x0 + width(ctx, '$ '), y0, CREAM);
      }
      dither(ctx, prog(t, T.URL, T.URL + 0.3), c => { font(c, 30, MONO, 500); c.textAlign = 'center'; text(c, C.url, W / 2, base + fs * 0.62 + 120, MUTED); c.textAlign = 'left'; }, { cell: 4, rise: 14 });
    }
    for (const at of [T.H2, T.MAIN]) {
      const hit = 1 - prog(t, at, at + 0.35);
      if (t >= at && hit > 0) { ctx.fillStyle = rgba(RED, 0.1 * hit * hit); ctx.fillRect(-20, -20, W + 40, H + 40); }
    }
    ctx.restore();
  },

  post(ctx, t, { W, H }) { vignette(ctx, W, H, 0.3); },
};
