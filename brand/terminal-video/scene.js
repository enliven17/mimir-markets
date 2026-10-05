// Mimir Terminal launch (16 s, 120 BPM, bar = 2 s, step = 125 ms), 16:9. Fast: the hook slams three lines in a
// bar, then three beats a bar and a half each, every event on a 16th. Markets live (the command types, rows slam
// in with their pools rolling and their bars filling), an agent (the house roster pops, the question types, the
// reply streams, the price per message lands), a token (the address pastes, the price rolls, three checks resolve),
// then the horn and "Talk to the market." with the site's pixel scribble under the last word.
// Same system as ../daily-02-video (helpers copied from it).
// Facts: the commands and their columns (/terminal), 20 house agents, thinking agents 0.01 USDC a message to their
// own wallet, the token checks (mint authority, freeze authority, top holders). Illustrations: the market rows,
// the reply and the token ($RANDO is made up).
import { TAU, prog, rgba, E, EASE, spring, setFont, clamp, lerp, shake, vignette, rrect } from '../../engine/core.js';

// ── tokens (app/globals.css)
const INK = [17, 15, 14], INK_DEEP = [10, 8, 8], PANEL2 = [39, 33, 32], CREAM = [243, 234, 214], MUTED = [168, 157, 147];
const DIM = [146, 135, 128], RED = [255, 43, 43], CORAL = [255, 81, 72], WIN = [159, 214, 168], PENDING = [255, 179, 173];
const DANGER = [255, 147, 140];
const GLASS_CARD = 'rgba(28,20,21,0.93)';
const DISPLAY = "'Terminal Grotesque'", PIXEL = "'Geist Pixel Square'", MONO = "'Geist Mono'";

// ── copy (the caption track). A leading * marks a red line.
const COPY = {
  en: {
    hook: [['Every', 'market.'], ['Every', 'agent.'], ['One', 'prompt.']],
    beats: [['Live markets.', '*One command.'], ['Ask an agent.', '*Get a side.'], ['Check a token.', '*First.']],
    beatsWide: [['Live', 'markets.', '*One command.'], ['Ask an', 'agent.', '*Get a side.'], ['Check a', 'token.', '*Before you', '*touch it.']],
    end: ['Talk to the', 'market.'], url: 'mimirmarkets.xyz/terminal', beta: 'BETA · LIVE ON DEVNET',
  },
};

// ── illustrations (the shape of the real output)
const ROWS = [
  ['#51', 'Will New Orleans beat Atlanta on Sunday?', 'live', 15, 0.2, '11h 47m'],
  ['#35', 'Will NVDA close above its previous close?', 'live', 7, 0.43, '7h 52m'],
  ['#58', 'Will BTC trade above $120k on Friday?', 'open', 24, 0.55, '2d 4h'],
  ['#62', 'Will it rain in London tomorrow?', 'open', 9, 0.7, '19h 10m'],
];
const ROSTER = ['optimist', 'pessimist', 'contrarian', 'statistician', 'whale-watcher', 'crypto-maxi', 'doomer', 'socrates', 'taleb', 'feynman'];
const QUESTION = 'is #51 worth a challenge?';
const REPLY = ["Only $3 sits against the creator, so the", "challenge side pays about 4 to 1. I'd take", "a small one. A late injury report changes it."];
const CA = '7xRaNd0mCoiN5oLaNa…9pump';

// ── beat grid: every event on a 16th (sound.py mirrors these)
const T = {};
function times(at) {
  Object.assign(T, {
    H1: at(0, 1), H2: at(0, 4), H3: at(0, 8), SCRIB: at(0, 11), H_OUT: at(1, 4),
    B1: at(1, 6), TYPE1: at(1, 8), ROW0: at(1, 12), HOT: at(2, 8),
    B2: at(3, 0), AV0: at(3, 1), Q: at(3, 6), REPLY: at(3, 11), PAY: at(4, 5),
    B3: at(4, 12), PASTE: at(4, 14), PRICE: at(5, 1), G0: at(5, 6),
    END: at(6, 4), HORN: at(6, 6), MAIN: at(6, 9), SCRIB2: at(6, 13), URL: at(7, 0), BETA: at(7, 2),
  });
  T.rowAt = i => T.ROW0 + i * at(0, 1);
  T.avAt = i => T.AV0 + i * at(0, 1) * 0.5;
  T.gAt = i => T.G0 + i * 3 * at(0, 1);
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

/** A prompt line: `mimir›` then `cmd` typed from t0 at `cps` characters a second, a caret while it types. */
function promptLine(c, t, x, y, cmd, t0, { cps = 34, who = 'mimir›', size = 30 } = {}) {
  font(c, size, MONO, 500); c.textAlign = 'left';
  text(c, who, x, y, CORAL);
  const px = x + width(c, who) + size * 0.5, n = clamp(Math.floor((t - t0) * cps), 0, cmd.length);
  font(c, size, MONO, 700); text(c, cmd.slice(0, n), px, y, CREAM);
  const blink = n < cmd.length || Math.floor(t * 4) % 2 === 0;
  if (t >= t0 - 0.3 && blink) { c.fillStyle = rgba(CORAL); c.fillRect(px + width(c, cmd.slice(0, n)) + 3, y - size * 0.8, size * 0.5, size * 0.95); }
}

// 1 · markets live: the command types, the rows slam in, pools roll, bars fill, #51 lights up
function markets(c, t, x, y, w, h) {
  well(c, x, y, w, h, 'Mimir Terminal', 'markets live');
  const pad = 40;
  promptLine(c, t, x + pad, y + 118, 'markets live', T.TYPE1);
  font(c, 22, MONO); c.textAlign = 'left';
  const cols = [0, 80, 560, 660, 870];
  if (t >= T.ROW0 - 0.06) ['#', 'market', 'pool', 'creator side', 'left'].forEach((s, i) => text(c, s, x + pad + cols[i], y + 172, DIM));
  ROWS.forEach(([id, q, state, pool, side, left], i) => {
    const t0 = T.rowAt(i), age = t - t0;
    if (age < 0) return;
    const ry = y + 226 + i * 56, k = EASE.expo(prog(t, t0, t0 + 0.35));
    c.save(); c.globalAlpha = clamp(age / 0.08); c.translate((1 - k) * 60, 0);
    if (i === 0 && t >= T.HOT) {
      const hp = EASE.expo(prog(t, T.HOT, T.HOT + 0.3));
      rrect(c, x + pad - 14, ry - 36, (w - pad * 2 + 28) * hp, 50, 8); c.fillStyle = rgba(RED, 0.16); c.fill();
    }
    font(c, 26, MONO, 600); text(c, id, x + pad + cols[0], ry, RED);
    font(c, 26, MONO, 700); text(c, q.length > 30 ? `${q.slice(0, 29)}…` : q, x + pad + cols[1], ry, CREAM);
    rolling(c, [[0, '$0'], [t0 + 0.05, `$${pool}`]], t, x + pad + cols[2], ry, { size: 26, col: CREAM, flash: false });
    const bw = 130, f = side * EASE.expo(prog(t, t0 + 0.08, t0 + 0.6));
    rrect(c, x + pad + cols[3], ry - 20, bw, 18, 4); c.fillStyle = rgba(PANEL2); c.fill();
    rrect(c, x + pad + cols[3], ry - 20, Math.max(6, bw * f), 18, 4); c.fillStyle = rgba(CREAM, 0.85); c.fill();
    font(c, 24, MONO, 500); text(c, `${Math.round(f * 100)}%`, x + pad + cols[3] + bw + 14, ry, MUTED);
    text(c, left, x + pad + cols[4], ry, CREAM);
    c.restore();
  });
}

// 2 · an agent: the house roster pops, `use optimist`, the question, the reply streams, the price lands
function agent(c, t, x, y, w, h) {
  well(c, x, y, w, h, 'House agents', '20 personas · or bring your own');
  const pad = 40;
  ROSTER.forEach((a, i) => {
    const age = t - T.avAt(i);
    if (age < 0) return;
    avatar(c, img[a], x + pad + 36 + i * 62, y + 120, 72, clamp(spring(age, 18, 8), 0, 1.25));
  });
  promptLine(c, t, x + pad, y + 222, 'use optimist', T.AV0 + 0.3, { cps: 40 });
  promptLine(c, t, x + pad, y + 280, QUESTION, T.Q, { who: 'optimist›', cps: 44 });
  if (t >= T.REPLY) {
    c.fillStyle = rgba(RED); c.fillRect(x + pad, y + 312, 4, 170 * EASE.expo(prog(t, T.REPLY, T.REPLY + 0.3)));
    avatar(c, img.optimist, x + pad + 40, y + 344, 44);
    font(c, 26, MONO, 700); c.textAlign = 'left'; text(c, 'optimist', x + pad + 76, y + 353, CREAM);
    font(c, 24, MONO); text(c, '· house agent', x + pad + 76 + 134, y + 353, MUTED);
    const total = REPLY.join('').length, n = Math.floor(clamp((t - T.REPLY - 0.15) / 1.4) * total);
    let used = 0;
    font(c, 27, MONO, 500);
    REPLY.forEach((ln, i) => { const k = clamp(n - used, 0, ln.length); used += ln.length; text(c, ln.slice(0, k), x + pad + 24, y + 404 + i * 38, CREAM); });
  }
  if (t >= T.PAY) {
    const k = clamp(spring(t - T.PAY, 15, 8), 0, 1.25);
    c.save(); c.translate(x + w - pad, y + 222); c.scale(k, k);
    pill(c, 0, 0, '0.01 USDC / message', { fg: CORAL, bg: CORAL, bga: 0.16, size: 26, fam: MONO, dotCol: CORAL, align: 'right' });
    c.restore();
    font(c, 22, PIXEL, 500); c.textAlign = 'right'; text(c, "paid to the agent's own wallet", x + w - pad, y + 270, DIM, prog(t, T.PAY + 0.15, T.PAY + 0.4)); c.textAlign = 'left';
  }
}

// 3 · a token: the address pastes, the price rolls, three checks resolve
function token(c, t, x, y, w, h) {
  well(c, x, y, w, h, '$RANDO · Random Coin', 'Solana mainnet');
  const pad = 40;
  font(c, 30, MONO, 500); c.textAlign = 'left'; text(c, 'mimir›', x + pad, y + 118, CORAL);
  if (t >= T.PASTE) {
    const fl = 1 - prog(t, T.PASTE, T.PASTE + 0.4);
    font(c, 30, MONO, 700); text(c, CA, x + pad + width(c, 'mimir›  '), y + 118, [0, 1, 2].map(k => lerp(CREAM[k], CORAL[k], fl)));
  }
  if (t >= T.PRICE) {
    const R = T.PRICE, st = 0.0625;
    const ev = [[0, '$0.0000000'], [R, '$0.0001840'], [R + st, '$0.0002910'], [R + 2 * st, '$0.0003560'], [R + 3 * st, '$0.0004120']];
    rolling(c, ev, t, x + pad, y + 222, { size: 78, col: CREAM, fam: MONO });
    font(c, 30, MONO, 600); text(c, '▲ 212% 24h', x + pad + 560, y + 214, DANGER, prog(t, R + 0.2, R + 0.4));
    font(c, 26, MONO); const sa = prog(t, R + 0.25, R + 0.5);
    let sx = x + pad;
    [['mcap', '$412K'], ['liquidity', '$9.8K'], ['vol 24h', '$1.2M'], ['holders', '311']].forEach(([k, v]) => {
      text(c, k, sx, y + 270, MUTED, sa); sx += width(c, k) + 12; text(c, v, sx, y + 270, CREAM, sa); sx += width(c, v) + 46;
    });
  }
  c.fillStyle = 'rgba(243,234,214,0.12)'; c.fillRect(x + pad, y + 304, w - pad * 2, 2);
  [['Mint authority', 'can mint more', false], ['Top 10 holders', '61% of supply', false], ['Freeze authority', 'off', true]].forEach(([label, res, ok], i) => {
    const t0 = T.gAt(i), ry = y + 360 + i * 68;
    if (t < T.G0 - 0.3) return;
    font(c, 28, PIXEL, 500); c.textAlign = 'left'; text(c, label, x + pad, ry, CREAM);
    if (t < t0) { pill(c, x + w - pad, ry - 9, 'checking…', { fg: PENDING, bg: PENDING, bga: 0.1, size: 24, align: 'right' }); return; }
    const k = clamp(spring(t - t0, 16, 8), 0, 1.25), col = ok ? WIN : DANGER;
    c.save(); c.translate(x + w - pad, ry - 9); c.scale(k, k);
    pill(c, 0, 0, `${ok ? '✓' : '✕'} ${res}`, { fg: col, bg: col, bga: 0.15, size: 26, fam: MONO, align: 'right' });
    c.restore();
    const rp = prog(t, t0, t0 + 0.45);
    if (rp < 1) { c.save(); c.globalAlpha = (1 - rp) * 0.5; c.strokeStyle = rgba(col); c.lineWidth = 3; c.beginPath(); c.arc(x + w - pad - 110, ry - 9, 20 + rp * 170, 0, TAU); c.stroke(); c.restore(); }
  });
}

// ── the headline block: a rolling step numeral beside (1:1) or above (16:9) the lines
function headline(c, t, HD, W) {
  const marks = [T.B1, T.B2, T.B3];
  let idx = 0; marks.forEach((m, i) => { if (t >= m) idx = i; });
  const t0 = marks[idx], p = idx ? E.inOutCubic(prog(t, t0, t0 + 0.5)) : 1;
  const { x, nb, ns } = HD;
  font(c, ns, DISPLAY, 400, -0.04 * ns);
  const numW = width(c, '2');
  { const gx = x + numW / 2, gy = nb - ns * 0.36, g = c.createRadialGradient(gx, gy, 0, gx, gy, ns * 0.75);
    g.addColorStop(0, 'rgba(255,43,43,0.12)'); g.addColorStop(1, 'rgba(255,43,43,0)'); c.fillStyle = g; c.fillRect(gx - ns, gy - ns, ns * 2, ns * 2); }
  c.save(); c.beginPath(); c.rect(x - 20, nb - ns * 0.8, numW + 40, ns * 0.92); c.clip();
  c.textAlign = 'left';
  const pos = idx - 1 + p;
  for (let d = 0; d < 3; d++) { const off = (d - pos) * ns * 0.94; if (Math.abs(off) < ns) text(c, String(d + 1), x, nb + off, RED); }
  c.restore();
  const beside = HD.mode === 'beside', tx = beside ? x + numW + 40 : x, maxW = HD.right - tx;
  const beats = (beside ? COPY.en.beats : COPY.en.beatsWide).map(b => b.map(s => ({ s: s.replace(/^\*/, ''), red: s.startsWith('*') })));
  const rows = Math.max(...beats.map(b => b.length));
  const fs = Math.min(...beats.map(b => fitSize(c, b.map(l => l.s), maxW, HD.cap))), lift = fs * (rows + 0.1);
  const baseOf = (i, n) => (beside ? nb - (n - 1 - i) * fs : HD.lb + i * fs);
  const drawLines = (ls, dy, a) => { display(c, fs); ls.forEach((l, i) => line(c, l.s, tx, baseOf(i, ls.length) + dy, l.red ? RED : CREAM, a)); };
  const top = beside ? nb - fs * (rows + 0.05) : HD.lb - fs * 1.05;
  c.save(); c.beginPath(); c.rect(tx - 20, top, W, fs * (rows + 0.35)); c.clip();
  if (idx && p < 1) drawLines(beats[idx - 1], -p * lift, clamp(1 - p * 4));
  const ip = idx ? EASE.expo(prog(t, t0 + 0.14, t0 + 0.62)) : 1;
  drawLines(beats[idx], (1 - ip) * lift, 1);
  c.restore();
}

// ── layout (16:9): the headline in a column on the left, one panel on the right
const COL = { w: 1100 };
function layoutFor(W, H) {
  const cx = W - 80 - COL.w;
  return { hook: 190, horn: 400, end: 170, urlSz: 44, field: 16,
    head: { mode: 'below', x: 110, nb: 380, ns: 250, lb: 520, right: cx - 60, cap: 112 },
    col: { x: cx, k: 1 } };
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
    buildField(W, H, layoutFor(W, H).field);
    const base = import.meta.url.replace(/scene\.js.*$/, '');
    img.horn = await loadImg(`${base}horn.svg`);
    for (const a of ROSTER) img[a] = await loadImg(`${base}avatars/${a}.svg`);
  },

  draw(ctx, t, api) {
    const { W, H } = api, C = COPY[api.lang] ?? COPY.en, S = layoutFor(W, H);
    const inCol = (h, fn) => c => { c.save(); c.translate(S.col.x, (H - h) / 2 + 40); fn(c, h); c.restore(); };
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, rgba(INK)); bg.addColorStop(1, rgba(INK_DEEP));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const frame = t * 24;
    const [sx, sy] = shake(t, [[T.H1 + 0.03, 6], [T.H2 + 0.03, 6], [T.H3 + 0.03, 9], [T.PASTE, 5], [T.MAIN, 8]]);
    ctx.save(); ctx.translate(sx, sy);

    // ── the field: full under the hook, a thin band under the beats, back for the end card
    const heroField = prog(t, 0, 0.3) * (1 - prog(t, T.H_OUT, T.B1 + 0.3));
    if (heroField > 0) field(ctx, frame, 0.9 * heroField, heroMask);
    const beatField = prog(t, T.B1, T.B1 + 0.5) * (1 - prog(t, T.END - 0.3, T.END));
    if (beatField > 0) field(ctx, frame, 0.32 * beatField, (u, v) => clamp((0.36 - u) / 0.3) * clamp((v - 0.62) / 0.3));
    const endField = prog(t, T.END + 0.05, T.HORN + 0.6);
    if (endField > 0) field(ctx, frame, 0.55 * endField, endMask);

    // ── 0 · the hook: three lines slam in on the beat, the scribble under "prompt."
    const hp = life(t, T.H1, 0.18, T.H_OUT, 0.2);
    if (hp > 0) dither(ctx, hp, c => {
      const fs = Math.min(...C.hook.map(l => fitSize(c, [l.join(' ')], W - 200, S.hook)));
      const base0 = H * 0.5 - fs * 0.95;
      C.hook.forEach(([lead, accent], i) => {
        const t0 = [T.H1, T.H2, T.H3][i];
        if (t < t0) return;
        const k = clamp(spring(t - t0, 18, 9), 0, 1.2), y = base0 + i * fs * 1.0;
        c.save(); c.translate(W / 2, y); c.scale(lerp(1.35, 1, k), lerp(1.35, 1, k)); c.globalAlpha = clamp((t - t0) / 0.06);
        if (i < 2) { display(c, fs); lineC(c, `${lead} ${accent}`, 0, 0, CREAM); }
        else slogan(c, 0, 0, fs, prog(t, T.SCRIB, T.SCRIB + 0.45), lead, accent);
        c.restore();
      });
    }, { cell: 9, rise: 20 });

    // ── 1–3 · the headline and one panel per beat
    const how = life(t, T.B1, 0.25, T.END, 0.25);
    if (how > 0) {
      dither(ctx, how, c => headline(c, t, S.head, W), { cell: 7, rise: 0 });
      const panels = [
        [T.B1 + 0.04, T.B2, 480, (c, h) => markets(c, t, 0, 0, COL.w, h)],
        [T.B2 + 0.04, T.B3, 520, (c, h) => agent(c, t, 0, 0, COL.w, h)],
        [T.B3 + 0.04, T.END, 580, (c, h) => token(c, t, 0, 0, COL.w, h)],
      ];
      panels.forEach(([a, b, h, fn]) => {
        const p = Math.min(life(t, a, 0.25, b, 0.18), how);
        if (p > 0) dither(ctx, p, inCol(h, fn), { cell: 6, rise: 30 });
      });
    }

    // ── end card: the horn, "Talk to the market." with the scribble under "market.", the URL, beta
    if (t >= T.END) {
      const hp2 = prog(t, T.HORN, T.HORN + 0.5), hs = S.horn, hx = W / 2, hy = H * 0.34;
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
      const base = H * 0.77;
      const fs = fitSize(ctx, [C.end.join(' ')], W - 200, S.end);
      const k = clamp(spring(t - T.MAIN, 15, 8), 0, 1.15);
      dither(ctx, prog(t, T.MAIN, T.MAIN + 0.3), c => {
        c.save(); c.translate(W / 2, base); c.scale(lerp(1.2, 1, k), lerp(1.2, 1, k));
        slogan(c, 0, 0, fs, prog(t, T.SCRIB2, T.SCRIB2 + 0.45), C.end[0], C.end[1]);
        c.restore();
      }, { cell: 8, rise: 30 });
      dither(ctx, prog(t, T.URL, T.URL + 0.3), c => { font(c, S.urlSz, MONO, 500); c.textAlign = 'center'; text(c, C.url, W / 2, base + fs * 0.62 + 24, MUTED); c.textAlign = 'left'; }, { cell: 4, rise: 16 });
      if (t >= T.BETA) {
        const kb = clamp(spring(t - T.BETA, 16, 8), 0, 1.2);
        ctx.save(); ctx.translate(W / 2, base + fs * 0.62 + 96); ctx.scale(kb, kb);
        font(ctx, 24, MONO, 500); const bw = width(ctx, C.beta);
        pill(ctx, -(bw + 24 * 1.9) / 2, 0, C.beta, { fg: PENDING, bg: RED, bga: 0.14, size: 24, fam: MONO, dotCol: RED });
        ctx.restore();
      }
    }
    for (const at of [T.H3, T.MAIN]) {
      const hit = 1 - prog(t, at, at + 0.35);
      if (t >= at && hit > 0) { ctx.fillStyle = rgba(RED, 0.1 * hit * hit); ctx.fillRect(-20, -20, W + 40, H + 40); }
    }
    ctx.restore();
  },

  post(ctx, t, { W, H }) { vignette(ctx, W, H, 0.3); },
};
