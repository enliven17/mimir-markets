// Mimir, "Testnet campaign is live" (15 s, 120 BPM, bar = 2 s). The hook over the ASCII wave field, three beats on
// how points are earned (devnet volume and copy trades; agents, baskets and follows; invites), the first-100 boost
// with the early badge, then the horn and "Climb the board." Same system as ../daily-02-video (helpers copied from
// it). The on-screen words are the caption track, so it reads without sound.
// Facts: lib/campaign.ts (weights, caps, invite share, ×1.1 invited, ×1.5 for the first 100). The invite code, the
// stakes and the running score are illustrations.
import { TAU, prog, rgba, E, EASE, spring, setFont, clamp, lerp, shake, vignette, rrect } from '../../engine/core.js';

// ── tokens (app/globals.css)
const INK = [17, 15, 14], INK_DEEP = [10, 8, 8], PANEL2 = [39, 33, 32], CREAM = [243, 234, 214], MUTED = [168, 157, 147];
const DIM = [146, 135, 128], RED = [255, 43, 43], CORAL = [255, 81, 72], WIN = [159, 214, 168], PENDING = [255, 179, 173];
const GLASS_CARD = 'rgba(28,20,21,0.93)';
const DISPLAY = "'Terminal Grotesque'", PIXEL = "'Geist Pixel Square'", MONO = "'Geist Mono'";

// ── copy (the caption track). A leading * marks a red line.
const COPY = {
  en: {
    hook: ['Testnet campaign', 'is live.'], live: 'LIVE · devnet · mimirmarkets.xyz/campaign',
    beats: [['Trade on devnet.', '*Volume scores.'], ['Bring agents.', '*Build baskets.'], ['Invite friends.', '*Earn on theirs.']],
    beatsWide: [['Trade on', 'devnet.', '*Volume scores.'], ['Bring agents.', '*Build baskets.'], ['Invite', 'friends.', '*Earn on theirs.']],
    boost: ['First 100', 'to join'], boostSub: 'on all your own points',
    end: ['Climb the', 'board.'], url: 'mimirmarkets.xyz/campaign',
  },
};

// ── the real rules (lib/campaign.ts)
const VOLUME = [['Devnet volume', '10', 'per USDC staked'], ['Copy trades', '50', 'per executed copy']];
const BUILD = [['Agents connected', '500', 'each · up to 5'], ['Baskets created', '300', 'each · up to 5'], ['Baskets followed', '100', 'each · up to 20']];
// illustrations
const CODE = 'K7Q2M9XA', STAKES = [['#41', '12'], ['#44', '15'], ['#47', '8']];

// ── beat grid: every event on a 16th (sound.py mirrors these)
const T = {};
function times(at) {
  Object.assign(T, {
    H1: at(0, 1), LIVE: at(0, 6), SCRIB: at(0, 8), H_OUT: at(1, 2),
    B1: at(1, 4), ROW0: at(1, 6), STAKE0: at(1, 10), COPY: at(2, 4),
    B2: at(2, 8), BROW0: at(2, 10),
    B3: at(3, 12), TYPE: at(3, 14), JOIN: at(4, 4), BONUS: at(4, 7), SHARE: at(4, 10),
    BOOST: at(5), MULT: at(5, 3), EARLY: at(5, 7), B_OUT: at(5, 14),
    END: at(6), HORN: at(6, 1), MAIN: at(6, 4), SCRIB2: at(6, 9), URL: at(6, 11),
  });
  T.rowAt = i => T.ROW0 + i * 2 * at(0, 1);
  T.stakeAt = i => T.STAKE0 + i * 2 * at(0, 1);
  T.browAt = i => T.BROW0 + i * 3 * at(0, 1);
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

/** A points row: label and note on the left, the points slamming in on the right. */
function pointsRow(c, t, t0, x, y, w, [label, pts, note]) {
  const a = clamp((t - t0 + 0.12) / 0.12);
  if (a <= 0) return;
  c.save(); c.globalAlpha = a;
  display(c, 50); c.textAlign = 'left'; text(c, label, x, y, CREAM);
  font(c, 26, MONO); text(c, note, x, y + 40, DIM);
  const k = clamp(spring(t - t0 - 0.08, 15, 8), 0, 1.25);
  if (k > 0) {
    c.save(); c.translate(x + w, y + 8); c.scale(k, k);
    c.shadowColor = rgba(RED, 0.45); c.shadowBlur = 20;
    display(c, 92); c.textAlign = 'right'; text(c, pts, -70, 0, CORAL);
    font(c, 30, PIXEL, 500); text(c, 'pts', 0, 0, MUTED);
    c.restore();
  }
  c.restore();
}

// 1 · volume: the rules, then three stakes land and the score rolls with each
function volume(c, t, x, y, w, h) {
  well(c, x, y, w, h, 'How points work', 'per action');
  VOLUME.forEach((r, i) => pointsRow(c, t, T.rowAt(i), x + 40, y + 140 + i * 120, w - 80, r));
}
function score(c, t, x, y, w, h) {
  well(c, x, y, w, h, 'Your score', 'devnet');
  const pad = 40;
  let total = 0;
  const ev = [[0, '0']];
  STAKES.forEach(([, usdc], i) => { total += Number(usdc) * 10; ev.push([T.stakeAt(i), total.toLocaleString('en-US')]); });
  total += 50; ev.push([T.COPY, total.toLocaleString('en-US')]);
  rolling(c, ev, t, x + pad, y + 210, { size: 130, col: CREAM });
  STAKES.forEach(([id, usdc], i) => {
    const age = t - T.stakeAt(i);
    if (age < 0) return;
    const k = clamp(spring(age, 16, 8), 0, 1.2);
    c.save(); c.translate(x + w - pad, y + 110 + i * 46); c.scale(k, k);
    pill(c, 0, 0, `${id} · ${usdc} USDC`, { fg: CREAM, bg: CREAM, bga: 0.08, size: 24, fam: MONO, align: 'right' });
    c.restore();
  });
  if (t >= T.COPY) {
    const k = clamp(spring(t - T.COPY, 16, 8), 0, 1.2);
    c.save(); c.translate(x + pad, y + h - 44); c.scale(k, k);
    pill(c, 0, 0, '+ copy trade', { fg: CORAL, bg: CORAL, bga: 0.16, size: 24, dotCol: CORAL });
    c.restore();
  }
}

// 2 · agents, baskets, follows
function build(c, t, x, y, w, h) {
  well(c, x, y, w, h, 'Agents and baskets', 'capped, so no farming');
  BUILD.forEach((r, i) => pointsRow(c, t, T.browAt(i), x + 40, y + 150 + i * 160, w - 80, r));
}

// 3 · invite: the link types, a friend joins, the bonus lands
function invite(c, t, x, y, w, h) {
  well(c, x, y, w, h, 'Your invite link', 'one free signature');
  const pad = 40, s = `mimirmarkets.xyz/campaign?ref=${CODE}`, n = Math.ceil(s.length * prog(t, T.TYPE, T.TYPE + 0.6));
  rrect(c, x + pad, y + 92, w - pad * 2, 76, 14); c.fillStyle = rgba(INK_DEEP); c.fill();
  font(c, 30, MONO, 500); c.textAlign = 'left'; text(c, s.slice(0, n), x + pad + 24, y + 142, CREAM);
  if (n < s.length && t >= T.TYPE) { c.fillStyle = rgba(CORAL); c.fillRect(x + pad + 26 + width(c, s.slice(0, n)), y + 112, 3, 38); }
  // a friend joins with the code
  if (t >= T.JOIN) {
    const k = clamp(spring(t - T.JOIN, 15, 8), 0, 1.15);
    c.save(); c.globalAlpha = clamp((t - T.JOIN) / 0.1); c.translate(x + pad, y + 214 + (1 - Math.min(1, k)) * 30);
    avatar(c, img.friend, 40, 40, 80);
    display(c, 50); text(c, 'friend joined', 104, 44, CREAM);
    font(c, 26, MONO); text(c, `invited by ${CODE} · ×1.1 for them`, 104, 82, DIM);
    c.restore();
  }
  // what you get
  const by = y + h - 120;
  c.fillStyle = 'rgba(243,234,214,0.12)'; c.fillRect(x + pad, by - 44, w - pad * 2, 2);
  [[T.BONUS, '+250', 'once they score'], [T.SHARE, '+10%', 'of all they earn']].forEach(([t0, big, small], i) => {
    if (t < t0) return;
    const k = clamp(spring(t - t0, 15, 8), 0, 1.25), bx = x + pad + i * (w - pad * 2) / 2;
    c.save(); c.translate(bx, by + 40); c.scale(k, k);
    c.shadowColor = rgba(RED, 0.45); c.shadowBlur = 20;
    display(c, 96); c.textAlign = 'left'; text(c, big, 0, 0, CORAL);
    c.restore();
    font(c, 26, PIXEL, 500); text(c, small, bx, by + 86, MUTED, prog(t, t0 + 0.1, t0 + 0.35));
  });
}

// 4 · the boost: first 100 to join, ×1.5 and the early badge
function boost(c, t, W, H, C) {
  const cx = W / 2;
  display(c, 120);
  lineC(c, C.boost[0], cx, H * 0.24, CREAM);
  lineC(c, C.boost[1], cx, H * 0.24 + 112, CREAM);
  if (t >= T.MULT) {
    const k = clamp(spring(t - T.MULT, 13, 7), 0, 1.3), age = t - T.MULT;
    const g = c.createRadialGradient(cx, H * 0.56, 0, cx, H * 0.56, 380);
    g.addColorStop(0, `rgba(255,43,43,${0.28 * clamp(age / 0.4)})`); g.addColorStop(1, 'rgba(17,15,14,0)');
    c.fillStyle = g; c.fillRect(0, H * 0.28, W, H * 0.6);
    c.save(); c.translate(cx, H * 0.64); c.scale(k, k);
    c.shadowColor = rgba(RED, 0.6); c.shadowBlur = 40 * clamp(1 - age / 0.9) + 12;
    display(c, 300); c.textAlign = 'center'; text(c, '×1.5', 0, 0, RED);
    c.restore();
  }
  font(c, 34, PIXEL, 500); c.textAlign = 'center'; text(c, C.boostSub, cx, H * 0.72, MUTED, prog(t, T.MULT + 0.3, T.MULT + 0.6));
  if (t >= T.EARLY) {
    const k = clamp(spring(t - T.EARLY, 16, 8), 0, 1.25);
    c.save(); c.translate(cx, H * 0.83); c.scale(k * 1.6, k * 1.6);
    font(c, 22, MONO, 600, 3);
    const label = 'EARLY', bw = width(c, label) + 40;
    rrect(c, -bw / 2, -20, bw, 40, 20); c.fillStyle = rgba(CORAL, 0.16); c.fill();
    c.strokeStyle = rgba(CORAL, 0.5); c.lineWidth = 1.5; c.stroke();
    c.textBaseline = 'middle'; c.textAlign = 'center'; text(c, label, 0, 1, CORAL);
    c.restore();
    const rp = prog(t, T.EARLY, T.EARLY + 0.6);
    if (rp < 1) { c.save(); c.globalAlpha = (1 - rp) * 0.5; c.strokeStyle = rgba(CORAL); c.lineWidth = 3; c.beginPath(); c.arc(cx, H * 0.83, 40 + rp * 260, 0, TAU); c.stroke(); c.restore(); }
  }
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
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

// ── layout (1:1): the panels live in a 940×694 column under the headline
const COL = { w: 940, h: 694 };
function layoutFor(W, H) {
  return { hook: 150, liveSz: 28, liveY: 0.68, horn: 360, end: 150, urlSz: 40, field: 14,
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
    img.friend = await loadImg(`${base}avatars/w0.svg`);
  },

  draw(ctx, t, api) {
    const { W, H } = api, C = COPY[api.lang] ?? COPY.en, S = layoutFor(W, H), K = S.col;
    const inCol = fn => c => { c.save(); c.translate(K.x, K.y); c.scale(K.k, K.k); fn(c); c.restore(); };
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, rgba(INK)); bg.addColorStop(1, rgba(INK_DEEP));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const frame = t * 24;
    const [sx, sy] = shake(t, [[T.H1 + 0.05, 4], [T.MULT, 9], [T.MAIN, 7]]);
    ctx.save(); ctx.translate(sx, sy);

    // ── the field: full under the hook, gone for the beats, low under the boost, back for the end card
    const heroField = prog(t, 0, 0.5) * (1 - prog(t, T.H_OUT, T.B1 + 0.4));
    if (heroField > 0) field(ctx, frame, 0.85 * heroField, heroMask);
    const boostField = prog(t, T.BOOST, T.BOOST + 0.5) * (1 - prog(t, T.B_OUT, T.END));
    if (boostField > 0) field(ctx, frame, 0.35 * boostField, heroMask);
    const endField = prog(t, T.END + 0.1, T.HORN + 0.8);
    if (endField > 0) field(ctx, frame, 0.5 * endField, endMask);

    // ── 0 · the hook: "Testnet campaign / is live." with the scribble, the live pill under it
    const hp0 = life(t, T.H1, 0.35, T.H_OUT, 0.22);
    if (hp0 > 0) dither(ctx, hp0, c => {
      const fs = fitSize(c, C.hook, W - 140, S.hook), k = clamp(spring(t - T.H1, 14, 8), 0, 1.15);
      c.save(); c.translate(W / 2, H * 0.4); c.scale(lerp(1.15, 1, k), lerp(1.15, 1, k));
      display(c, fs); lineC(c, C.hook[0], 0, 0, CREAM);
      slogan(c, 0, fs * 1.0, fs, prog(t, T.SCRIB, T.SCRIB + 0.65), 'is', 'live.');
      c.restore();
    }, { cell: 9, rise: 24 });
    const lp = life(t, T.LIVE, 0.3, T.H_OUT, 0.22);
    if (lp > 0) dither(ctx, lp, c => {
      font(c, S.liveSz, MONO, 500); const w = width(c, C.live) + 80, x0 = W / 2 - w / 2, y = H * S.liveY;
      rrect(c, x0, y - 30, w, 60, 30); c.fillStyle = rgba(RED, 0.14); c.fill();
      dot(c, x0 + 34, y, 8, RED, 14 + 10 * Math.sin(t * 8));
      c.textAlign = 'left'; c.textBaseline = 'middle'; text(c, C.live, x0 + 58, y + 1, PENDING); c.textBaseline = 'alphabetic';
    }, { cell: 4, rise: 16, second: true });

    // ── 1–3 · the headline and the panels per beat
    const how = life(t, T.B1, 0.4, T.BOOST, 0.3);
    if (how > 0) {
      dither(ctx, how, c => headline(c, t, S.head, W), { cell: 7, rise: 0 });
      const W1 = COL.w, panels = [
        [T.B1 + 0.05, T.B2, 0.2, inCol(c => volume(c, t, 0, 0, W1, 360))],
        [T.STAKE0 - 0.25, T.B2, 0.2, inCol(c => score(c, t, 0, 384, W1, 310))],
        [T.B2 + 0.1, T.B3, 0.2, inCol(c => build(c, t, 0, 0, W1, 600))],
        [T.B3 + 0.1, T.BOOST, 0.3, inCol(c => invite(c, t, 0, 0, W1, 560))],
      ];
      panels.forEach(([a, b, dout, fn]) => {
        const p = Math.min(life(t, a, 0.35, b, dout), how);
        if (p > 0) dither(ctx, p, fn, { cell: 6, rise: 24 });
      });
    }

    // ── 4 · the boost
    const bp = life(t, T.BOOST, 0.35, T.B_OUT, 0.3);
    if (bp > 0) dither(ctx, bp, c => boost(c, t, W, H, C), { cell: 8, rise: 30 });

    // ── end card: the horn, "Climb the board." with the scribble, the URL
    if (t >= T.END) {
      const hp = prog(t, T.HORN, T.HORN + 0.8), hs = S.horn, hx = W / 2, hy = H * 0.33;
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
      const base = H * 0.76;
      const fs = fitSize(ctx, [C.end.join(' ')], W - 120, S.end);
      const k = clamp(spring(t - T.MAIN, 13, 8), 0, 1.15);
      dither(ctx, prog(t, T.MAIN, T.MAIN + 0.5), c => {
        c.save(); c.translate(W / 2, base); c.scale(lerp(1.12, 1, k), lerp(1.12, 1, k));
        slogan(c, 0, 0, fs, prog(t, T.SCRIB2, T.SCRIB2 + 0.65), C.end[0], C.end[1]);
        c.restore();
      }, { cell: 8, rise: 30 });
      dither(ctx, prog(t, T.URL, T.URL + 0.5), c => { font(c, S.urlSz, MONO, 500); c.textAlign = 'center'; text(c, C.url, W / 2, base + fs * 0.62 + 20, MUTED); c.textAlign = 'left'; }, { cell: 4, rise: 16 });
    }
    const hit = 1 - prog(t, T.MAIN, T.MAIN + 0.45);
    if (t >= T.MAIN && hit > 0) { ctx.fillStyle = rgba(RED, 0.09 * hit * hit); ctx.fillRect(-20, -20, W + 40, H + 40); }
    ctx.restore();
  },

  post(ctx, t, { W, H }) { vignette(ctx, W, H, 0.28); },
};
