// Mimir daily 01, "What is Mimir?" (12 s, 120 BPM, bar = 2 s). A hook over the ASCII wave field, the slogan
// with its scribble, three fast beats (stake a side, agents challenge on the rollup, the oracle stamps a verdict
// with a verify hash), then the horn, the name and the URL. The on-screen words are the caption track, so the
// clip reads without sound. Layout reads from `api.W` / `api.H`: project.json is the 1080×1080 cut,
// project.wide.json the 1920×1080 one (headline on the left, card and panels on the right). Pieces and helpers
// come from ../launch-video/scene.js (the site's tokens, the hero field, the scribble, the Bayer dither, the
// rolling numbers, the claim card and its odds bar).
import { TAU, prog, rgba, E, EASE, spring, setFont, clamp, lerp, shake, vignette, rrect, pointer } from '../../engine/core.js';

// ── tokens (app/globals.css)
const INK = [17, 15, 14], INK_DEEP = [10, 8, 8], PANEL2 = [39, 33, 32], CREAM = [243, 234, 214], MUTED = [168, 157, 147];
const DIM = [146, 135, 128], RED = [255, 43, 43], CORAL = [255, 81, 72], WIN = [159, 214, 168], PENDING = [255, 179, 173];
const GLASS_CARD = 'rgba(28,20,21,0.93)';
const DISPLAY = "'Terminal Grotesque'", PIXEL = "'Geist Pixel Square'", MONO = "'Geist Mono'";

// ── copy (the caption track: few words, big type)
const COPY = {
  en: {
    hook: ['Every argument online', 'ends the same way.'],
    nobody: 'Nobody settles it.',
    replies: 'replies', settled: '0 settled',
    lead: "Don't argue.", accent: 'Settle.',
    beats: [['Stake a side.'], ['AI agents challenge it.', 'Zero fee.'], ['An AI oracle settles it,', 'with receipts.']],
    // the same words broken for the narrower 16:9 column
    beatsWide: [['Stake a side.'], ['AI agents', 'challenge it.', 'Zero fee.'], ['An AI oracle', 'settles it,', 'with receipts.']],
    yes: 'Yes', no: 'No',
    name: 'Mimir', url: 'mimirmarkets.xyz',
  },
};

// ── the claim (illustration: question, wallets, stakes, latencies, price, confidence and hash are placeholders)
const CLAIM = { id: 18, category: 'Crypto', q: ['Will SOL close above', '$200 on Oct 31?'] };
const CREATOR = 200;
const STAKES = [['7xQm…3fa1', 40, 28], ['Bv2k…Hq7c', 25, 31], ['9Lzt…w0Ra', 60, 27], ['Fm4e…pX2s', 30, 30], ['2cYn…Td8u', 45, 29]]; // [wallet, USDC, ms]
const EVIDENCE = [['source', 'coingecko.com · SOL/USD'], ['close', '$187.42 < $200  →  No']];
const HASH = '9f3c…a41e';
const CUM = STAKES.reduce((a, s) => [...a, (a.at(-1) ?? 0) + s[1]], []);

// ── beat grid: every event on a 16th (sound.py mirrors these)
const T = {};
function times(at) {
  Object.assign(T, {
    H1: at(0, 1), H1_OUT: at(0, 12), H2: at(0, 12), H2_OUT: at(1, 4),
    TURN: at(1, 4), SCRIB: at(1, 9), TURN_OUT: at(1, 15),
    B1: at(2), PRESS: at(2, 6), B2: at(2, 12), STAKE0: at(2, 14),
    B3: at(3, 8), EVID: at(3, 9), STAMP: at(3, 12), CONF: at(3, 14), HASH: at(4), DISPUTE: at(4, 2),
    END: at(4, 8), HORN: at(4, 10), NAME: at(4, 14), URL: at(5, 2),
  });
  T.stakeAt = i => T.STAKE0 + i * 2 * at(0, 1);
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
/** The slogan on one line, "Settle." in red, the scribble under it, centred on cx. */
function slogan(c, cx, base, fs, scribP) {
  display(c, fs);
  const L = COPY.en.lead + ' ', A = COPY.en.accent, wl = width(c, L), wa = width(c, A), x0 = cx - (wl + wa) / 2;
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

// ── the claim's state at time t
function stakesIn(t) { let n = 0; STAKES.forEach((_, i) => { if (t >= T.stakeAt(i)) n = i + 1; }); return n; }
const shareAt = n => CREATOR / (CREATOR + (n ? CUM[n - 1] : 0));
const pct = s => `${Math.round(s * 100)}%`;

/** The claim card (ClaimCard.tsx, compact): header, question, odds bar, the two sides. Top-left at (x, y). */
function claimCard(c, t, x, y, w, h) {
  const pad = 44;
  card(c, x, y, w, h);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  // header: id and category, then the ER pill while it is live, then "Proposed" once stamped
  const live = life(t, T.B2, 0.3, T.STAMP - 0.12, 0.12), prop = prog(t, T.STAMP, T.STAMP + 0.15), idle = 1 - prog(t, T.B2, T.B2 + 0.2);
  if (idle > 0) { font(c, 28, MONO); text(c, `#${CLAIM.id} · ${CLAIM.category}`, x + pad, y + 62, DIM, idle); }
  if (live > 0) { c.save(); c.globalAlpha = live; pill(c, x + pad, y + 52, 'Live on ER', { dotCol: CORAL, size: 26 }); c.restore(); }
  if (prop > 0) { c.save(); c.globalAlpha = prop; pill(c, x + pad, y + 52, 'Proposed', { dotCol: PENDING, size: 26 }); c.restore(); }
  // pool, rolling with every stake
  const poolEv = [[0, '$0'], [T.PRESS, `$${CREATOR}`], ...STAKES.map((s, i) => [T.stakeAt(i), `$${CREATOR + CUM[i]}`])];
  const pw = rolling(c, poolEv, t, x + w - pad, y + 64, { size: 40, align: 'right' });
  font(c, 28, PIXEL, 500); c.textAlign = 'right'; text(c, 'pool', x + w - pad - pw - 14, y + 62, DIM); c.textAlign = 'left';
  // question
  display(c, 66);
  CLAIM.q.forEach((l, i) => text(c, l, x + pad, y + 136 + i * 66, CREAM));
  // odds bar: hatched until the first counter-stake, then a coral track with the cream creator share
  const bx = x + pad, by = y + 236, bw = w - pad * 2, bh = 16, n = stakesIn(t);
  if (!n) hatch(c, bx, by, bw, bh);
  else {
    const t0 = T.stakeAt(n - 1), share = lerp(shareAt(n - 1), shareAt(n), EASE.expo(prog(t, t0, t0 + 0.6)));
    c.save(); rrect(c, bx, by, bw, bh, 3); c.clip();
    c.fillStyle = rgba(CORAL); c.fillRect(bx, by, bw, bh);
    c.fillStyle = rgba(CREAM); c.fillRect(bx, by, bw * share, bh);
    c.fillStyle = rgba(INK); c.fillRect(bx + bw * share, by, 3, bh);
    c.restore();
    if (t >= T.STAMP) { // the proposed side glows
      const g = 1 - prog(t, T.STAMP, T.STAMP + 0.9), s = shareAt(STAKES.length);
      c.save(); c.shadowColor = rgba(CORAL, 0.9); c.shadowBlur = 34 * g + 8; rrect(c, bx + bw * s + 3, by, bw * (1 - s) - 3, bh, 3); c.fillStyle = rgba(CORAL); c.fill(); c.restore();
    }
  }
  // the two sides under the bar
  const ly = y + 296, sz = 36;
  const yesEv = [[0, '-'], [T.PRESS, '100%'], ...STAKES.map((_, i) => [T.stakeAt(i), pct(shareAt(i + 1))])];
  const noEv = [[0, '-'], ...STAKES.map((_, i) => [T.stakeAt(i), pct(1 - shareAt(i + 1))])];
  const wl = rolling(c, yesEv, t, bx, ly, { size: sz, col: CREAM, flash: false });
  font(c, 32, PIXEL, 500); text(c, COPY.en.yes, bx + wl + 14, ly, MUTED);
  const wr = rolling(c, noEv, t, bx + bw, ly, { size: sz, col: CORAL, align: 'right', flash: false });
  font(c, 32, PIXEL, 500); c.textAlign = 'right'; text(c, COPY.en.no, bx + bw - wr - 14, ly, MUTED); c.textAlign = 'left';
  // the verdict stamp, slammed onto the card
  if (t >= T.STAMP) stamp(c, t, x + w - 168, y + 162);
}

/** A rubber stamp "No." that slams in with a spring and settles at a tilt. */
function stamp(c, t, cx, cy) {
  const age = t - T.STAMP, k = spring(age, 15, 9), s = lerp(1.9, 1, clamp(k)), a = clamp(age / 0.06);
  c.save(); c.translate(cx, cy); c.rotate(-0.12); c.scale(s, s); c.globalAlpha = a;
  const bw = 262, bh = 134;
  c.fillStyle = 'rgba(28,12,12,0.86)'; rrect(c, -bw / 2, -bh / 2, bw, bh, 18); c.fill();
  c.lineWidth = 7; c.strokeStyle = rgba(CORAL); rrect(c, -bw / 2, -bh / 2, bw, bh, 18); c.stroke();
  c.lineWidth = 2; c.strokeStyle = rgba(CORAL, 0.5); rrect(c, -bw / 2 + 12, -bh / 2 + 12, bw - 24, bh - 24, 10); c.stroke();
  display(c, 116); c.textAlign = 'left';
  const nw = width(c, 'No'), dw = width(c, '.'), x0 = -(nw + dw) / 2;
  text(c, 'No', x0, 38, CORAL); text(c, '.', x0 + nw, 38, RED);
  c.restore();
}

/** Under the card in beat 1: the two sides as buttons; the pointer picks Yes. */
function sides(c, t, x, y, w) {
  const gap = 24, bw = (w - gap) / 2, bh = 124, pressed = t >= T.PRESS;
  const press = t >= T.PRESS && t < T.PRESS + 0.12 ? 0.95 : 1;
  [[COPY.en.yes, CREAM, 0], [COPY.en.no, CORAL, 1]].forEach(([label, col, i]) => {
    const bx = x + i * (bw + gap), on = i === 0 && pressed;
    c.save(); c.translate(bx + bw / 2, y + bh / 2); c.scale(i === 0 ? press : 1, i === 0 ? press : 1);
    rrect(c, -bw / 2, -bh / 2, bw, bh, bh / 2); c.fillStyle = on ? rgba(CREAM) : rgba(col, 0.12); c.fill();
    c.lineWidth = 2; c.strokeStyle = rgba(col, on ? 1 : 0.35); c.stroke();
    display(c, 76); c.textAlign = 'center'; text(c, label, 0, 26, on ? INK : col); c.textAlign = 'left';
    c.restore();
  });
  // the stake rising from the button into the card
  const fp = prog(t, T.PRESS, T.PRESS + 0.7);
  if (fp > 0 && fp < 1) {
    font(c, 38, MONO, 500); c.textAlign = 'center';
    text(c, `+${CREATOR} USDC`, x + bw / 2, y - 24 - EASE.expo(fp) * 50, CREAM, 1 - fp * fp); c.textAlign = 'left';
  }
  // a ring off the press
  const rp = prog(t, T.PRESS, T.PRESS + 0.5);
  if (rp > 0 && rp < 1) { c.save(); c.globalAlpha = (1 - rp) * 0.6; c.strokeStyle = rgba(CREAM); c.lineWidth = 3; c.beginPath(); c.arc(x + bw / 2 + 40, y + bh / 2, 30 + rp * 220, 0, TAU); c.stroke(); c.restore(); }
  // the pointer: glides in, clicks, leaves
  const mp = EASE.expo(prog(t, T.B1 + 0.15, T.PRESS - 0.05));
  const px = lerp(x + w * 0.86, x + bw / 2 + 40, mp), py = lerp(y + bh + 150, y + bh / 2 + 4, mp) + EASE.expo(prog(t, T.PRESS + 0.3, T.B2)) * 220;
  const pa = 1 - prog(t, T.PRESS + 0.3, T.B2 - 0.1);
  if (pa > 0) { c.save(); c.globalAlpha = pa; pointer(c, px, py, 1.6, t >= T.PRESS && t < T.PRESS + 0.12 ? 1 : 0); c.restore(); }
}

/** Beat 2: the agents' stakes streaming in on the rollup, newest on top. */
function feed(c, t, x, y, w, h) {
  const n = stakesIn(t);
  well(c, x, y, w, h, 'Ephemeral Rollup', `${n} tx · $0.00 fees`);
  const pad = 40, rowH = 80, top = y + 84;
  const shown = STAKES.map((s, i) => ({ addr: s[0], amt: s[1], ms: s[2], t0: T.stakeAt(i), img: img.w[i] })).filter(r => t >= r.t0);
  if (!shown.length) return;
  const newest = shown.at(-1), slide = 1 - EASE.expo(prog(t, newest.t0, newest.t0 + 0.3));
  c.save(); c.beginPath(); c.rect(x, top - 4, w, h - (top - y) - 6); c.clip();
  shown.slice().reverse().forEach((r, j) => {
    const age = t - r.t0, yy = top + (j - slide) * rowH + rowH / 2;
    const k = j === 0 ? clamp(spring(age, 16, 9), 0, 1.2) : 1;
    const a = j === 0 ? clamp(age / 0.1) : clamp((3.2 - (j - slide)) / 0.6);
    if (a <= 0) return;
    if (j === 0 && age < 0.5) { c.save(); c.globalAlpha = (1 - age / 0.5) * 0.2; rrect(c, x + 12, yy - rowH / 2 + 4, w - 24, rowH - 8, 16); c.fillStyle = rgba(CORAL); c.fill(); c.restore(); }
    c.save(); c.globalAlpha = a; c.translate((1 - Math.min(1, k)) * 26, 0);
    avatar(c, r.img, x + pad + 26, yy, 54);
    font(c, 30, MONO); c.textAlign = 'left'; text(c, r.addr, x + pad + 72, yy + 10, CREAM);
    pill(c, x + pad + 300, yy, 'agent · No', { fg: CORAL, bg: CORAL, bga: 0.12, size: 24 });
    font(c, 32, MONO, 500); c.textAlign = 'right'; text(c, `+${r.amt} USDC`, x + w * 0.73, yy + 11, CREAM);
    font(c, 28, MONO); text(c, '0 fee', x + w * 0.85, yy + 10, MUTED);
    text(c, `${Math.round(r.ms * EASE.expo(prog(t, r.t0, r.t0 + 0.2)))} ms`, x + w - pad, yy + 10, CORAL);
    c.textAlign = 'left';
    c.restore();
  });
  c.restore();
}

/** Beat 3: the oracle reads the evidence; the receipts are the confidence, the verify hash and the dispute window. */
function oracle(c, t, x, y, w, h) {
  const proposed = t >= T.STAMP, pad = 40;
  well(c, x, y, w, h, 'AI Oracle', proposed ? 'verdict proposed' : 'reading evidence…', proposed ? PENDING : MUTED);
  const ly0 = y + 108, lh = 44;
  font(c, 30, MONO); c.textAlign = 'left';
  EVIDENCE.forEach(([k, v], i) => {
    const t0 = T.EVID + i * 0.19, chars = Math.floor((k.length + v.length + 2) * prog(t, t0, t0 + 0.2));
    if (chars <= 0) return;
    text(c, k.slice(0, chars), x + pad, ly0 + i * lh, DIM);
    text(c, v.slice(0, Math.max(0, chars - k.length - 2)), x + pad + 140, ly0 + i * lh, i === 1 && chars >= k.length + v.length ? CREAM : MUTED);
  });
  // a scan line reading the well
  const sp = prog(t, T.EVID, T.STAMP);
  if (sp > 0 && sp < 1) {
    const sy = ly0 - 34 + sp * (lh * 2 + 10);
    const g = c.createLinearGradient(0, sy - 30, 0, sy); g.addColorStop(0, 'rgba(255,43,43,0)'); g.addColorStop(1, 'rgba(255,43,43,0.16)');
    c.fillStyle = g; c.fillRect(x + 14, sy - 30, w - 28, 30); c.fillStyle = rgba(RED, 0.5); c.fillRect(x + 14, sy, w - 28, 2);
  }
  // confidence and the verify hash
  const ry = y + 252, cp = prog(t, T.CONF, T.CONF + 0.2);
  if (cp > 0) {
    c.save(); c.globalAlpha = cp;
    font(c, 24, PIXEL, 500, 1); text(c, 'CONFIDENCE', x + pad, ry - 52, DIM);
    const cw = rolling(c, [[0, '0%'], [T.CONF, '91%']], t, x + pad, ry, { size: 54, col: CREAM });
    pill(c, x + pad + cw + 18, ry - 18, 'High', { fg: WIN, bg: WIN, bga: 0.12, size: 24 });
    c.restore();
  }
  const hp = prog(t, T.HASH, T.HASH + 0.25);
  if (hp > 0) {
    const s = `${HASH} ↗`, hx = x + w * 0.47;
    font(c, 24, PIXEL, 500, 1); text(c, 'VERIFY', hx, ry - 52, DIM, hp);
    font(c, 44, MONO, 500); text(c, s.slice(0, Math.ceil(s.length * hp)), hx, ry, CORAL);
  }
  // 24 h dispute window with a 2 USDC bond, time-lapsed
  const dp = prog(t, T.DISPUTE, T.DISPUTE + 0.2);
  if (dp > 0) {
    const dy = y + h - 30;
    c.save(); c.globalAlpha = dp;
    font(c, 26, PIXEL, 500); text(c, 'Dispute window 24h · bond 2 USDC', x + pad, dy, MUTED);
    const bx = x + w * 0.66, bw = w - pad - (bx - x), fill = EASE.css(prog(t, T.DISPUTE + 0.1, T.END));
    rrect(c, bx, dy - 15, bw, 9, 4.5); c.fillStyle = rgba(PANEL2); c.fill();
    rrect(c, bx, dy - 15, Math.max(9, bw * fill), 9, 4.5); c.fillStyle = rgba(PENDING); c.fill();
    c.restore();
  }
}

// ── the headline block: a rolling step numeral beside one or two big lines
function headline(c, t, HD, W) {
  const marks = [T.B1, T.B2, T.B3];
  let idx = 0; marks.forEach((m, i) => { if (t >= m) idx = i; });
  const t0 = marks[idx], p = idx ? E.inOutCubic(prog(t, t0, t0 + 0.5)) : 1;
  const { x, nb, ns } = HD;
  // numeral: a column of digits rolling up (l-how-digits), with the red glow
  font(c, ns, DISPLAY, 400, -0.04 * ns);
  const numW = width(c, '2');
  { const gx = x + numW / 2, gy = nb - ns * 0.36, g = c.createRadialGradient(gx, gy, 0, gx, gy, ns * 0.75);
    g.addColorStop(0, 'rgba(255,43,43,0.12)'); g.addColorStop(1, 'rgba(255,43,43,0)'); c.fillStyle = g; c.fillRect(gx - ns, gy - ns, ns * 2, ns * 2); }
  c.save(); c.beginPath(); c.rect(x - 20, nb - ns * 0.8, numW + 40, ns * 0.92); c.clip();
  c.textAlign = 'left';
  const pos = idx - 1 + p;
  for (let d = 0; d < 3; d++) { const off = (d - pos) * ns * 0.94; if (Math.abs(off) < ns) text(c, String(d + 1), x, nb + off, RED); }
  c.restore();
  // lines: the old pair lifts away, the new pair rises out of its mask
  // beside: the lines sit right of the numeral, bottom-aligned to it (1:1); below: they hang under it (16:9)
  const beside = HD.mode === 'beside', tx = beside ? x + numW + 40 : x, maxW = HD.right - tx;
  const beats = HD.mode === 'beside' ? COPY.en.beats : COPY.en.beatsWide, rows = Math.max(...beats.map(b => b.length));
  const fs = Math.min(...beats.map(b => fitSize(c, b, maxW, HD.cap))), lift = fs * (rows + 0.1);
  const baseOf = (i, n) => (beside ? nb - (n - 1 - i) * fs : HD.lb + i * fs);
  const drawLines = (ls, dy, a) => {
    display(c, fs);
    ls.forEach((s, i) => line(c, s, tx, baseOf(i, ls.length) + dy, ls.length > 1 && i === ls.length - 1 ? RED : CREAM, a));
  };
  const top = beside ? nb - fs * 2.05 : HD.lb - fs * 1.05;
  c.save(); c.beginPath(); c.rect(tx - 20, top, W, fs * (rows + 0.35)); c.clip();
  if (idx && p < 1) drawLines(beats[idx - 1], -p * lift, clamp(1 - p * 4));
  const ip = idx ? EASE.expo(prog(t, t0 + 0.14, t0 + 0.62)) : 1;
  drawLines(beats[idx], (1 - ip) * lift, 1);
  c.restore();
}

// ── layout: the card and its panels live in a 940-wide column, placed and scaled per aspect ratio
const L = { w: 940, cardH: 330, gap: 24, ph: 340 };
const COL_H = L.cardH + L.gap + L.ph;
function layoutFor(W, H) {
  if (W / H > 1.3) {
    const k = 1, cx = W - 100 - 940 * k;
    return { wide: true, hookCap: 150, nobodyCap: 190, sloganFs: 168, counter: 44, horn: 470, name: 180, urlSz: 46, field: 16,
      head: { mode: 'below', x: 120, nb: 430, ns: 260, lb: 570, right: cx - 70, cap: 116 },
      col: { x: cx, y: (H - COL_H * k) / 2, k } };
  }
  return { wide: false, hookCap: 118, nobodyCap: 150, sloganFs: 124, counter: 40, horn: 420, name: 168, urlSz: 44, field: 14,
    head: { mode: 'beside', x: 64, nb: 262, ns: 214, right: W - 56, cap: 104 },
    col: { x: 70, y: 322, k: 1 } };
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
    img.w = await Promise.all(STAKES.map((_, i) => loadImg(`${base}avatars/w${i}.svg`)));
  },

  draw(ctx, t, api) {
    const { W, H } = api, C = COPY[api.lang] ?? COPY.en, S = layoutFor(W, H), K = S.col;
    const inCol = fn => c => { c.save(); c.translate(K.x, K.y); c.scale(K.k, K.k); fn(c); c.restore(); };
    // background: ink to ink-deep
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, rgba(INK)); bg.addColorStop(1, rgba(INK_DEEP));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const frame = t * 24; // the hero field paints at 24 fps on the site
    const [sx, sy] = shake(t, [[T.H2, 6], [T.STAMP, 9]]);
    ctx.save(); ctx.translate(sx, sy);

    // ── the field: full under the hook and the slogan, gone for the three beats, back for the end card
    const heroField = prog(t, 0, 0.6) * (1 - prog(t, T.TURN_OUT, T.B1 + 0.4));
    if (heroField > 0) field(ctx, frame, 0.85 * heroField, heroMask);
    const endField = prog(t, T.END + 0.1, T.HORN + 0.8);
    if (endField > 0) field(ctx, frame, 0.5 * endField, endMask);

    // ── 0 · the hook
    const h1 = life(t, T.H1, 0.45, T.H1_OUT, 0.2);
    if (h1 > 0) dither(ctx, h1, c => {
      const fs = fitSize(c, C.hook, W - 150, S.hookCap);
      display(c, fs); C.hook.forEach((s, i) => lineC(c, s, W / 2, H * 0.398 + i * fs * 1.04, CREAM));
    }, { cell: 9, rise: 30 });
    const h2 = life(t, T.H2, 0.25, T.H2_OUT, 0.2);
    if (h2 > 0) dither(ctx, h2, c => {
      const fs = fitSize(c, [C.nobody], W - 130, S.nobodyCap), k = clamp(spring(t - T.H2, 16, 9), 0, 1.2);
      c.save(); c.translate(W / 2, H * 0.482); c.scale(lerp(1.12, 1, k), lerp(1.12, 1, k));
      display(c, fs); lineC(c, C.nobody, 0, fs * 0.3, CREAM); c.restore();
    }, { cell: 9, rise: 20 });
    // the thread under it: replies roll up, nothing settles
    const th = life(t, T.H1 + 0.3, 0.35, T.H2_OUT, 0.2);
    if (th > 0) dither(ctx, th, c => {
      const ev = [[0, '0'], [0.45, '14'], [0.7, '96'], [0.95, '388'], [1.2, '1,204']];
      const cy = H * 0.667, sz = S.counter;
      font(c, sz, MONO, 500); const rest = ` ${C.replies}  ·  `, full = width(c, '1,204' + rest + C.settled);
      const x0 = W / 2 - full / 2, nW = width(c, '1,204');
      rolling(c, ev, t, x0 + nW, cy, { size: sz, col: MUTED, align: 'right' });
      font(c, sz, MONO, 500); c.textAlign = 'left'; text(c, rest, x0 + nW, cy, DIM);
      const hot = t >= T.H2 ? 1 : 0, fl = hot ? 1 - prog(t, T.H2, T.H2 + 0.6) : 0;
      text(c, C.settled, x0 + nW + width(c, rest), cy, hot ? [255, lerp(43, 120, fl), lerp(43, 110, fl)] : DIM);
    }, { cell: 4, rise: 16, second: true });

    // ── the turn: "Don't argue. Settle." with the scribble
    const tp = life(t, T.TURN, 0.4, T.TURN_OUT, 0.22);
    if (tp > 0) dither(ctx, tp, c => slogan(c, W / 2, H * 0.5 + S.sloganFs * 0.29 - (t > T.TURN_OUT ? EASE.expo(prog(t, T.TURN_OUT, T.TURN_OUT + 0.3)) * 50 : 0), S.sloganFs, prog(t, T.SCRIB, T.SCRIB + 0.65)), { cell: 9, rise: 36 });

    // ── 1–3 · the headline, the card and one panel per beat
    const how = life(t, T.B1, 0.4, T.END, 0.3);
    if (how > 0) {
      dither(ctx, how, c => {
        headline(c, t, S.head, W);
        const k = clamp(spring(t - T.B1, 11, 7), 0, 1.1);
        inCol(g => claimCard(g, t, 0, (1 - k) * 60, L.w, L.cardH))(c);
      }, { cell: 7, rise: 0 });
      const py = L.cardH + L.gap, ph = L.ph;
      const panels = [
        [T.B1 + 0.1, T.B2, 0.2, inCol(c => sides(c, t, 0, py + (ph - 124) / 2, L.w))],
        [T.B2 + 0.15, T.B3, 0.22, inCol(c => feed(c, t, 0, py, L.w, ph))],
        [T.B3 + 0.08, T.END, 0.3, inCol(c => oracle(c, t, 0, py, L.w, ph))],
      ];
      panels.forEach(([a, b, dout, fn]) => {
        const p = Math.min(life(t, a, 0.35, b, dout), how);
        if (p > 0) dither(ctx, p, fn, { cell: 6, rise: 24 });
      });
    }
    // the stamp: a red wash
    const hit = 1 - prog(t, T.STAMP, T.STAMP + 0.4);
    if (t >= T.STAMP && hit > 0) { ctx.fillStyle = rgba(RED, 0.10 * hit * hit); ctx.fillRect(-20, -20, W + 40, H + 40); }

    // ── end card: the horn, the name, the URL
    if (t >= T.END) {
      const hp = prog(t, T.HORN, T.HORN + 0.8), hs = S.horn, hx = W / 2, hy = H * 0.37;
      const glow = EASE.expo(prog(t, T.HORN, T.HORN + 1.4));
      if (glow > 0) {
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hs * 1.15);
        g.addColorStop(0, `rgba(255,43,43,${0.30 * glow})`); g.addColorStop(0.55, `rgba(143,14,23,${0.14 * glow})`); g.addColorStop(1, 'rgba(17,15,14,0)');
        ctx.fillStyle = g; ctx.fillRect(hx - hs * 1.2, hy - hs * 1.2, hs * 2.4, hs * 2.4);
      }
      const drift = Math.sin((t - T.HORN) * 1.1) * 4;
      dither(ctx, hp, c => {
        const hh = hs, hw = hh * (1148 / 1256);
        c.save(); c.shadowColor = 'rgba(255,43,43,0.35)'; c.shadowBlur = 40;
        c.drawImage(img.horn, hx - hw / 2, hy - hh / 2 + drift, hw, hh); c.restore();
      }, { cell: 8, rise: 40 });
      const base = H * 0.8;
      dither(ctx, prog(t, T.NAME, T.NAME + 0.6), c => { display(c, S.name); lineC(c, C.name + '.', W / 2, base, CREAM); }, { cell: 8, rise: 30 });
      dither(ctx, prog(t, T.URL, T.URL + 0.5), c => { font(c, S.urlSz, MONO, 500); c.textAlign = 'center'; text(c, C.url, W / 2, base + S.name * 0.55, MUTED); c.textAlign = 'left'; }, { cell: 4, rise: 16 });
    }
    ctx.restore();
  },

  post(ctx, t, { W, H }) { vignette(ctx, W, H, 0.28); },
};
