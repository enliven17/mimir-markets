// Mimir daily 03, "What is the AI oracle?" (16:9, 19 s, 120 BPM, bar = 2 s). A different grammar from the earlier
// clips: kinetic type for the hook, ASCII-field wipes between scenes, then one continuous camera move across a
// single wide evidence canvas (the claim, the fetched source, the rule and the two price readings, an LLM read of
// a non-price claim, the receipt), with a terminal strip typing the oracle's steps and a timeline scrubber that
// takes over for propose → 24h dispute → finalize → payouts. End card: the horn and the slogan.
// Facts: agents/oracle/decide.ts (order of steps, tiers: 80+ FIRM, 60-79 CONTESTED, under 60 refund),
// lib/resolver-spec.ts, lib/price-consensus.ts, lib/research/gateway.ts (safe fetch), lib/verdict-bundle.ts,
// lib/solana/config.ts (2 USDC bond), docs/SOLANA.md (24h window, /verify). Claims, prices, the article,
// the confidence and the hash are illustrations.
import { TAU, prog, rgba, E, EASE, spring, setFont, clamp, lerp, shake, vignette, rrect } from '../../engine/core.js';

// ── tokens (app/globals.css)
const INK = [17, 15, 14], INK_DEEP = [10, 8, 8], PANEL2 = [39, 33, 32], CREAM = [243, 234, 214], MUTED = [168, 157, 147];
const DIM = [146, 135, 128], RED = [255, 43, 43], CORAL = [255, 81, 72], WIN = [159, 214, 168], PENDING = [255, 179, 173];
const GLASS_CARD = 'rgba(28,20,21,0.93)';
const DISPLAY = "'Terminal Grotesque'", PIXEL = "'Geist Pixel Square'", MONO = "'Geist Mono'";

// ── copy (the caption track). A leading * marks a red line.
const COPY = {
  en: {
    q: ['Who decides', 'who was right?'], a: ['An AI oracle.', 'With receipts.'],
    lead: "Don't argue.", accent: 'Settle.', url: 'mimirmarkets.xyz',
  },
};

// ── beat grid (sound.py mirrors these)
const T = {};
function times(at) {
  Object.assign(T, {
    Q1: at(0, 1), Q2: at(0, 6), WIPE1: at(1), A1: at(1, 2), A2: at(1, 6), WIPE2: at(1, 12),
    DEAD: at(2), FETCH: at(2, 8), RULES: at(3), READ2: at(3, 5), REFUND: at(3, 10),
    LLM: at(4, 4), CONF: at(4, 12), RECEIPT: at(5, 8), HASH: at(6), VERIFY: at(6, 6),
    PROPOSE: at(6, 12), DISPUTE: at(7, 2), FINAL: at(7, 10), PAYOUT: at(7, 13),
    END: at(8), HORN: at(8, 2), SLOGAN: at(8, 6), SCRIB: at(8, 10), URL: at(8, 12),
  });
}

// ── kinetic words over the canvas: [from, to, lines, style, sub]
const WORDS = () => [
  [T.DEAD, T.FETCH, ['Deadline.'], 'slam', 'the oracle wakes up'],
  [T.FETCH, T.RULES, ['Fetch the', 'source.'], 'wipe', 'safe fetch: no private hosts, size capped'],
  [T.RULES, T.REFUND, ['Rules', 'first.'], 'split', 'two price sources, no model asked'],
  [T.REFUND, T.LLM, ['Disagree?', '*Refund.'], 'slam', 'sources on both sides: everyone refunded'],
  [T.LLM, T.RECEIPT, ['No rule?', 'An LLM', 'reads it.'], 'wipe', 'verdict + confidence, then tiers'],
  [T.RECEIPT, T.PROPOSE, ['Receipts.'], 'split', 'sha256 on chain, recompute it at /verify'],
];

// ── the terminal: [at, line]
const TERM = () => [
  [T.DEAD + 0.05, '$ oracle settle #42'],
  [T.DEAD + 0.45, '> deadline passed · commit the ER state back to Solana'],
  [T.FETCH + 0.1, '> safe fetch flashapi.trade/prices/BTC · DNS checked, redirects re-checked'],
  [T.RULES + 0.1, '> resolver price:BTC:gt:83795.5 · data decides, no model asked'],
  [T.READ2 + 0.1, '> cross-check flashtrade 84,112.40 · coingecko 84,098.10 → agree'],
  [T.REFUND + 0.1, '> if they disagree → UNRESOLVABLE, every stake refunded'],
  [T.LLM + 0.1, '> claim #57 has no rule · LLM reads the fetched evidence'],
  [T.CONF + 0.1, '> verdict YES · confidence 86 → FIRM'],
  [T.RECEIPT + 0.1, '> seal bundle: claim, evidence, prices, rule, model, reasoning'],
  [T.HASH + 0.1, '> sha256 9f3c…a41e → evidence_hash on chain'],
  [T.VERIFY + 0.1, '> /verify/42 recomputes it · match'],
  [T.PROPOSE + 0.1, '> propose_resolution · 24h dispute window open'],
];

// ── the evidence canvas (world units): four regions in a row
const PANEL = { w: 1100, h: 760 };
const AT = { A: [0, 0], B: [1650, 0], C: [3300, 0], D: [4950, 0] };
const JSON_LINES = ['{', '  "symbol": "BTC",', '  "price": 84112.40,', '  "market": "BTC/USD",', '  "updatedAt": "2026-10-31T18:00:00Z",', '}'];
const PRICE_LINE = 2;
const ARTICLE = [
  'Release notes · Oct 28',
  'The team shipped a set of fixes this week',
  'and published the audit report in full.',
  'The v2 upgrade went live on Oct 28 at 14:00 UTC.',
  'Node operators were asked to update by Nov 2.',
  'A follow-up post covers the migration steps.',
];
const DECIDING = 3;
const BUNDLE_KEYS = ['claim', 'evidence', 'prices', 'resolver', 'model', 'rawVerdict', 'adjustments', 'finalVerdict'];

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

// ── small pieces
function arrowDown(c, x, y0, y1, col, a = 1) {
  c.save(); c.globalAlpha = a; c.strokeStyle = rgba(col); c.fillStyle = rgba(col); c.lineWidth = 3;
  c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1 - 10); c.stroke();
  c.beginPath(); c.moveTo(x - 9, y1 - 12); c.lineTo(x + 9, y1 - 12); c.lineTo(x, y1); c.closePath(); c.fill(); c.restore();
}
function typed(s, t, t0, cps = 60) { return s.slice(0, Math.max(0, Math.floor((t - t0) * cps))); }
function bar(c, x, y, w) { c.fillStyle = rgba(PANEL2); rrect(c, x, y, w, 70, [22, 22, 0, 0]); c.fill(); [0, 1, 2].forEach(i => dot(c, x + 38 + i * 26, y + 35, 8, i ? DIM : CORAL)); }
function scan(c, x, w, y, a = 1) {
  const g = c.createLinearGradient(0, y - 40, 0, y); g.addColorStop(0, 'rgba(255,43,43,0)'); g.addColorStop(1, `rgba(255,43,43,${0.2 * a})`);
  c.fillStyle = g; c.fillRect(x, y - 40, w, 40); c.fillStyle = rgba(RED, 0.6 * a); c.fillRect(x, y, w, 3);
}

// ── A · the claim at its deadline
function panelA(c, t) {
  card(c, -550, -280, 1100, 560);
  c.textAlign = 'left';
  dot(c, -494, -219, 7, RED);
  font(c, 30, PIXEL, 500, 1.5); text(c, 'CLAIM #42 · CRYPTO', -474, -208, RED);
  display(c, 84); text(c, 'Will BTC close above', -500, -110, CREAM); line(c, '$83,795.5 at 18:00 UTC?', -500, -26, CREAM);
  font(c, 26, MONO); text(c, 'flashapi.trade/prices/BTC#mimir=price:BTC:gt:83795.5', -500, 50, MUTED);
  c.fillStyle = 'rgba(243,234,214,0.12)'; c.fillRect(-500, 100, 1000, 2);
  font(c, 26, PIXEL, 500, 1); text(c, 'TIME LEFT', -500, 168, DIM);
  rolling(c, [[0, '00:00:02'], [T.WIPE2 + 0.25, '00:00:01'], [T.DEAD, '00:00:00']], t, -500, 238, { size: 56, col: t >= T.DEAD ? CORAL : CREAM });
  if (t >= T.DEAD) { // the deadline stamp
    const age = t - T.DEAD, k = spring(age, 15, 9), s = lerp(1.8, 1, clamp(k));
    c.save(); c.translate(270, 200); c.rotate(-0.09); c.scale(s, s); c.globalAlpha = clamp(age / 0.06);
    c.lineWidth = 6; c.strokeStyle = rgba(RED); rrect(c, -200, -62, 400, 124, 14); c.stroke();
    display(c, 84); c.textAlign = 'center'; text(c, 'DEADLINE', 0, 30, RED); c.textAlign = 'left';
    c.restore();
  }
}

// ── B · the fetched source, the rule, two price readings
const PX0 = 83600, PX1 = 84300, LINE_Y = 250;
const px = v => -480 + (v - PX0) / (PX1 - PX0) * 960;
function panelB(c, t) {
  card(c, -550, -380, 1100, 760, 22, 'rgba(16,10,11,0.96)');
  bar(c, -550, -380, 1100);
  c.textAlign = 'left'; font(c, 28, MONO, 500); text(c, 'flashapi.trade/prices/BTC', -440, -335, CREAM);
  if (t >= T.FETCH + 0.55) { const k = clamp(spring(t - T.FETCH - 0.55, 16, 8), 0, 1.2); c.save(); c.translate(520, -345); c.scale(k, k); pill(c, 0, 0, '✓ safe fetch', { fg: WIN, bg: WIN, bga: 0.14, size: 24, align: 'right' }); c.restore(); }
  const fp = prog(t, T.FETCH, T.FETCH + 0.55);
  if (fp > 0 && fp < 1) { c.fillStyle = rgba(CORAL); c.fillRect(-550, -312, 1100 * EASE.expo(fp), 4); }
  // the JSON, typed in
  const y0 = -240, lh = 56, py = y0 + PRICE_LINE * lh;
  if (t >= T.RULES) { const a = prog(t, T.RULES, T.RULES + 0.2); c.fillStyle = rgba(CORAL, 0.16 * a); rrect(c, -520, py - 40, 1040, 54, 8); c.fill(); c.fillStyle = rgba(RED, a); c.fillRect(-520, py - 40, 5, 54); }
  font(c, 34, MONO);
  JSON_LINES.forEach((s, i) => text(c, typed(s, t, T.FETCH + 0.35 + i * 0.07, 90), -500, y0 + i * lh, i === PRICE_LINE && t >= T.RULES ? CREAM : MUTED));
  const sp = prog(t, T.FETCH + 0.6, T.RULES);
  if (sp > 0 && sp < 1) scan(c, -540, 1080, lerp(y0 - 40, py + 10, EASE.css(sp)));
  // the magnifier on the deciding value
  const mk = clamp(spring(t - T.RULES - 0.15, 14, 8), 0, 1.15);
  if (t >= T.RULES + 0.15) {
    c.save(); c.translate(300, -150); c.scale(mk, mk);
    c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 30; c.beginPath(); c.arc(0, 0, 118, 0, TAU); c.fillStyle = 'rgba(28,20,21,0.98)'; c.fill(); c.shadowBlur = 0;
    c.lineWidth = 5; c.strokeStyle = rgba(CREAM, 0.85); c.stroke();
    c.lineWidth = 12; c.lineCap = 'round'; c.beginPath(); c.moveTo(84, 84); c.lineTo(140, 140); c.stroke();
    font(c, 22, PIXEL, 500, 1); c.textAlign = 'center'; text(c, 'PRICE', 0, -34, DIM);
    font(c, 50, MONO, 600); text(c, '84,112', 0, 22, CORAL); font(c, 30, MONO, 500); text(c, '.40', 0, 60, CORAL);
    c.restore(); c.textAlign = 'left';
  }
  // the rule chip
  const rp = prog(t, T.RULES + 0.3, T.RULES + 0.6);
  if (rp > 0) {
    c.save(); c.globalAlpha = rp;
    font(c, 24, PIXEL, 500, 1); text(c, 'RULE', -500, 110, DIM);
    pill(c, -420, 102, 'price:BTC:gt:83795.5', { fg: CREAM, bg: CREAM, bga: 0.08, size: 26, fam: MONO });
    c.restore();
  }
  // the number line: threshold and the two readings
  const lp = prog(t, T.RULES + 0.4, T.RULES + 0.8);
  if (lp > 0) {
    c.save(); c.globalAlpha = lp;
    c.fillStyle = rgba(PANEL2); c.fillRect(-480, LINE_Y - 2, 960, 4);
    const tx = px(83795.5);
    c.fillStyle = rgba(RED); c.fillRect(tx - 2, LINE_Y - 44, 4, 88);
    font(c, 22, MONO); c.textAlign = 'center'; text(c, '83,795.5', tx, LINE_Y + 72, RED); c.textAlign = 'left';
    font(c, 20, PIXEL, 500); text(c, 'below: No', -480, LINE_Y + 72, DIM); c.textAlign = 'right'; text(c, 'above: Yes', 480, LINE_Y + 72, DIM); c.textAlign = 'left';
    c.restore();
    const readings = [['flashtrade', 84112.4, T.RULES + 0.55, -1], ['coingecko', 84098.1, T.READ2, 1]];
    const off = life(t, T.REFUND + 0.05, 0.35, T.LLM - 0.45, 0.35); // the "what if they disagree" detour
    readings.forEach(([name, v, t0, side], i) => {
      if (t < t0) return;
      const k = clamp(spring(t - t0, 15, 8), 0, 1.2), vv = i === 1 ? lerp(v, 83690, EASE.expo(off)) : v, x = px(vv);
      const col = i === 1 && off > 0.5 ? RED : CORAL;
      c.save(); c.translate(x, LINE_Y); c.scale(k, k);
      dot(c, 0, 0, 13, col, 14);
      font(c, 20, MONO, 500); c.textAlign = 'center'; text(c, `${name} ${vv.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 0, side * 34 - (side < 0 ? 0 : -14), CREAM);
      c.restore(); c.textAlign = 'left';
    });
    const ok = prog(t, T.READ2 + 0.3, T.READ2 + 0.5) * (1 - off);
    font(c, 28, PIXEL, 500);
    if (ok > 0) text(c, 'both above the line → Yes', -480, LINE_Y + 118, WIN, ok);
    if (off > 0) text(c, 'they straddle it → UNRESOLVABLE, refund', -480, LINE_Y + 118, RED, off);
  }
}

// ── C · no rule: an LLM reads the evidence; confidence tiers
function panelC(c, t) {
  card(c, -550, -380, 1100, 760, 22, 'rgba(16,10,11,0.96)');
  bar(c, -550, -380, 1100);
  c.textAlign = 'left'; font(c, 28, MONO, 500); text(c, 'example.org/release-notes', -440, -335, CREAM);
  pill(c, 520, -345, 'claim #57 · no rule', { fg: PENDING, bg: PENDING, bga: 0.12, size: 24, align: 'right' });
  font(c, 30, PIXEL, 500); text(c, 'Did the v2 upgrade ship by Oct 31?', -500, -262, CREAM);
  const y0 = -200, lh = 44, dy = y0 + DECIDING * lh;
  const hl = prog(t, T.LLM + 0.55, T.LLM + 0.75);
  if (hl > 0) { c.fillStyle = rgba(CORAL, 0.16 * hl); rrect(c, -520, dy - 32, 1040, 44, 8); c.fill(); c.fillStyle = rgba(RED, hl); c.fillRect(-520, dy - 32, 5, 44); }
  font(c, 27, MONO);
  ARTICLE.forEach((s, i) => text(c, s, -500, y0 + i * lh, i === DECIDING && hl > 0 ? CREAM : i === 0 ? DIM : MUTED));
  const sp = prog(t, T.LLM + 0.15, T.LLM + 0.6);
  if (sp > 0 && sp < 1) scan(c, -540, 1080, lerp(y0 - 36, dy + 8, EASE.css(sp)));
  // the model's answer
  const vp = prog(t, T.LLM + 0.8, T.LLM + 1.0);
  if (vp > 0) {
    c.save(); c.globalAlpha = vp;
    font(c, 22, PIXEL, 500, 1); text(c, 'VERDICT', -500, 92, DIM); text(c, 'CONFIDENCE', -170, 92, DIM); text(c, 'MODEL', 200, 92, DIM);
    display(c, 100); text(c, 'Yes', -500, 180, CORAL); text(c, '.', -500 + width(c, 'Yes'), 180, RED);
    rolling(c, [[0, '0'], [T.CONF, '86']], t, -170, 172, { size: 76, col: CREAM });
    font(c, 26, MONO); text(c, 'recorded in', 200, 140, MUTED); text(c, 'the bundle', 200, 174, MUTED);
    c.restore();
  }
  // the tiers, from the code: under 60 refund, 60 to 79 CONTESTED, 80 and up FIRM
  const tp = prog(t, T.CONF - 0.2, T.CONF + 0.1);
  if (tp > 0) {
    c.save(); c.globalAlpha = tp;
    const x0 = -500, w = 1000, y = 270, X = v => x0 + w * v / 100;
    [[0, 60, DIM, 'under 60: refund'], [60, 80, PENDING, '60-79: CONTESTED'], [80, 100, CORAL, '80+: FIRM']].forEach(([a, b, col, label], i) => {
      c.fillStyle = rgba(col, i === 2 ? 0.95 : 0.5); c.fillRect(X(a) + (a ? 2 : 0), y, X(b) - X(a) - (a ? 2 : 0), 16);
      font(c, 22, PIXEL, 500); c.textAlign = i === 0 ? 'left' : i === 1 ? 'center' : 'right';
      text(c, label, i === 0 ? X(a) : i === 1 ? (X(a) + X(b)) / 2 : X(b), y - 16, i === 2 ? CORAL : MUTED);
    });
    c.textAlign = 'left';
    const mx = X(86 * EASE.expo(prog(t, T.CONF, T.CONF + 0.5)));
    c.fillStyle = rgba(CREAM); c.beginPath(); c.moveTo(mx, y + 22); c.lineTo(mx - 12, y + 44); c.lineTo(mx + 12, y + 44); c.closePath(); c.fill();
    if (t >= T.CONF + 0.5) { font(c, 24, MONO, 600); c.textAlign = 'center'; text(c, '86 → FIRM', mx, y + 76, CORAL); c.textAlign = 'left'; }
    c.restore();
  }
}

// ── D · the receipt: canonical JSON → sha256 → on chain → /verify
function panelD(c, t) {
  card(c, -550, -380, 1100, 760, 22, 'rgba(16,10,11,0.96)');
  c.textAlign = 'left';
  dot(c, -494, -319, 7, RED);
  font(c, 26, PIXEL, 500, 1.3); text(c, 'VERDICT BUNDLE · CANONICAL JSON', -474, -309, RED);
  font(c, 30, MONO);
  text(c, '{', -500, -246, MUTED, prog(t, T.RECEIPT + 0.1, T.RECEIPT + 0.2));
  BUNDLE_KEYS.forEach((k, i) => {
    const a = prog(t, T.RECEIPT + 0.15 + i * 0.07, T.RECEIPT + 0.25 + i * 0.07);
    if (a <= 0) return;
    c.save(); c.globalAlpha = a; c.translate((1 - a) * -20, 0);
    text(c, `  "${k}": `, -500, -202 + i * 42, CREAM); text(c, '{…},', -500 + width(c, `  "${k}": `), -202 + i * 42, DIM);
    c.restore();
  });
  text(c, '}', -500, -202 + BUNDLE_KEYS.length * 42, MUTED, prog(t, T.RECEIPT + 0.8, T.RECEIPT + 0.9));
  // packets from the JSON into the hash box
  const pk = life(t, T.RECEIPT + 0.5, 0.1, T.HASH + 0.1, 0.2);
  if (pk > 0) for (let k = 0; k < 4; k++) { const f = ((t * 1.6 + k / 4) % 1); c.save(); c.globalAlpha = pk; c.shadowColor = rgba(CORAL); c.shadowBlur = 12; c.fillStyle = rgba(CORAL); c.fillRect(lerp(-80, 120, f) - 5, -205 - 5, 10, 10); c.restore(); }
  // right column
  const bx = 120, bw = 400;
  const sp = prog(t, T.RECEIPT + 0.4, T.RECEIPT + 0.7);
  if (sp > 0) {
    c.save(); c.globalAlpha = sp;
    c.lineWidth = 3; c.strokeStyle = rgba(CORAL); rrect(c, bx, -250, bw, 90, 16); c.stroke();
    font(c, 32, MONO, 600); c.textAlign = 'center'; text(c, 'sha256(bundle)', bx + bw / 2, -193, CREAM); c.textAlign = 'left';
    c.restore();
  }
  if (t >= T.HASH) {
    arrowDown(c, bx + bw / 2, -152, -100, CORAL, prog(t, T.HASH, T.HASH + 0.15));
    font(c, 58, MONO, 600); c.textAlign = 'center'; text(c, typed('9f3c…a41e', t, T.HASH + 0.1, 30), bx + bw / 2, -30, CORAL); c.textAlign = 'left';
    arrowDown(c, bx + bw / 2, 0, 50, CORAL, prog(t, T.HASH + 0.4, T.HASH + 0.55));
    const ck = clamp(spring(t - T.HASH - 0.5, 16, 8), 0, 1.2);
    if (ck > 0) { c.save(); c.translate(bx + bw / 2, 92); c.scale(ck, ck); pill(c, 0, 0, 'evidence_hash · on chain', { fg: CREAM, bg: RED, bga: 0.2, size: 26, dotCol: RED, align: 'left' }); c.restore(); }
  }
  // anyone can recompute it
  const vp = prog(t, T.VERIFY, T.VERIFY + 0.3);
  if (vp > 0) {
    c.save(); c.globalAlpha = vp;
    c.fillStyle = 'rgba(243,234,214,0.05)'; rrect(c, -500, 190, 1000, 150, 18); c.fill();
    font(c, 40, MONO, 600); text(c, '/verify/42', -460, 258, CREAM);
    font(c, 26, MONO); text(c, 'sha256sum bundle.json = on-chain hash', -460, 304, MUTED);
    c.restore();
    const mk = clamp(spring(t - T.VERIFY - 0.25, 16, 8), 0, 1.2);
    if (mk > 0) { c.save(); c.translate(460, 265); c.scale(mk, mk); pill(c, 0, 0, '✓ match', { fg: WIN, bg: WIN, bga: 0.14, size: 34, align: 'right' }); c.restore(); }
  }
}

// ── the camera over the canvas: [time, x, y, zoom]
function camera(t) {
  const K = [
    [T.WIPE2, 0, 0, 0.6], [T.DEAD, 0, 0, 0.86], [T.FETCH, 30, 0, 0.88],
    [T.FETCH + 0.7, AT.B[0], 0, 0.84], [T.LLM, AT.B[0] + 20, 0, 0.86],
    [T.LLM + 0.7, AT.C[0], 0, 0.84], [T.RECEIPT, AT.C[0] + 20, 0, 0.86],
    [T.RECEIPT + 0.7, AT.D[0], 0, 0.84], [T.PROPOSE, AT.D[0] + 20, 0, 0.86],
    [T.PROPOSE + 0.9, AT.D[0] / 2, 0, 0.27],
  ];
  if (t <= K[0][0]) return K[0].slice(1);
  for (let i = 0; i < K.length - 1; i++) {
    const [a, ...p] = K[i], [b, ...q] = K[i + 1];
    if (t < b) { const e = E.inOutCubic(prog(t, a, b)); return p.map((v, k) => lerp(v, q[k], e)); }
  }
  return K.at(-1).slice(1);
}
function worldScene(c, t, W, H) {
  const [cx, cy, z] = camera(t), dim = 1 - 0.92 * prog(t, T.PROPOSE, T.PROPOSE + 0.45);
  c.save(); c.globalAlpha = dim;
  c.translate(W * 0.62, H * 0.47); c.scale(z, z); c.translate(-cx, -cy);
  // the canvas: a faint grid so the camera move reads as one surface
  c.strokeStyle = 'rgba(243,234,214,0.035)'; c.lineWidth = 1 / z;
  for (let x = -900; x <= 5900; x += 120) { c.beginPath(); c.moveTo(x, -700); c.lineTo(x, 700); c.stroke(); }
  for (let y = -660; y <= 660; y += 120) { c.beginPath(); c.moveTo(-900, y); c.lineTo(5900, y); c.stroke(); }
  // the thread that joins the four regions
  c.strokeStyle = rgba(RED, 0.35); c.lineWidth = 3; c.setLineDash([10, 12]); c.lineDashOffset = -t * 40;
  c.beginPath(); c.moveTo(550, 0); c.lineTo(AT.D[0] - 550, 0); c.stroke(); c.setLineDash([]);
  [['A', panelA], ['B', panelB], ['C', panelC], ['D', panelD]].forEach(([k, fn]) => { c.save(); c.translate(...AT[k]); fn(c, t); c.restore(); });
  c.restore();
}

// ── screen layers: the scrim, the words, the terminal, the scrubber
function scrim(c, W, H, a) {
  const g = c.createLinearGradient(0, 0, 860, 0); g.addColorStop(0, `rgba(10,8,8,${0.94 * a})`); g.addColorStop(0.7, `rgba(10,8,8,${0.75 * a})`); g.addColorStop(1, 'rgba(10,8,8,0)');
  c.fillStyle = g; c.fillRect(0, 0, 860, H);
}
function kinetic(c, t, lines, style, t0, x, y, fs, align = 'left') {
  display(c, fs);
  lines.forEach((raw, i) => {
    const red = raw.startsWith('*'), s = raw.replace(/^\*/, ''), yy = y + i * fs * 0.98, ti = t0 + i * 0.12, age = t - ti;
    if (age < 0) return;
    const w = width(c, s), x0 = align === 'center' ? x - w / 2 : x;
    c.save();
    if (style === 'slam') {
      const k = clamp(spring(age, 15, 8), 0, 1.15), s2 = lerp(1.5, 1, k);
      c.translate(x0 + w / 2, yy - fs * 0.35); c.scale(s2, s2); c.globalAlpha = clamp(age / 0.05); c.translate(-(x0 + w / 2), -(yy - fs * 0.35));
      line(c, s, x0, yy, red ? RED : CREAM);
    } else if (style === 'split') {
      const e = EASE.expo(prog(age, 0, 0.45)), dx = (1 - e) * (i % 2 ? 320 : -320);
      c.globalAlpha = clamp(age / 0.1);
      line(c, s, x0 + dx, yy, red ? RED : CREAM);
    } else { // wipe: a red bar leads the reveal
      const e = EASE.expo(prog(age, 0, 0.45));
      c.beginPath(); c.rect(x0 - 10, yy - fs, (w + 30) * e, fs * 1.25); c.clip();
      line(c, s, x0, yy, red ? RED : CREAM);
      c.restore(); c.save();
      if (e < 1) { c.fillStyle = rgba(RED); c.fillRect(x0 - 10 + (w + 30) * e - 8, yy - fs * 0.85, 8, fs); }
    }
    c.restore();
  });
}
function terminal(c, t, W, H, a) {
  if (a <= 0) return;
  const y = H - 150;
  c.save(); c.globalAlpha = a;
  c.fillStyle = 'rgba(8,6,6,0.95)'; c.fillRect(0, y, W, 150); c.fillStyle = rgba(CORAL, 0.35); c.fillRect(0, y, W, 2);
  font(c, 20, PIXEL, 500, 1.2); c.textAlign = 'right'; text(c, 'ORACLE · LOG', W - 110, y + 36, RED); c.textAlign = 'left';
  const shown = TERM().filter(([t0]) => t >= t0).slice(-3);
  font(c, 25, MONO);
  shown.forEach(([t0, s], i) => {
    const yy = y + 48 + i * 37, cur = typed(s, t, t0, 75), last = i === shown.length - 1;
    const pre = s[0], rest = cur.slice(1);
    text(c, pre, 110, yy, pre === '$' ? RED : CORAL); text(c, rest, 110 + width(c, pre), yy, last ? CREAM : MUTED);
    if (last && Math.floor(t * 3) % 2 === 0) { c.fillStyle = rgba(CREAM); c.fillRect(110 + width(c, cur) + 4, yy - 20, 12, 24); }
  });
  c.restore();
}
/** deadline → verdict proposed → 24h dispute → final → payouts. Compact at the top, then it takes the screen. */
function scrubber(c, t, W, H, a) {
  if (a <= 0) return;
  const ex = EASE.expo(prog(t, T.PROPOSE + 0.1, T.PROPOSE + 0.8));
  const y = lerp(62, H * 0.6, ex), x0 = lerp(110, 200, ex), x1 = lerp(W - 110, W - 200, ex), lw = lerp(3, 8, ex), ls = lerp(18, 30, ex);
  const X = f => lerp(x0, x1, f);
  const marks = [[0, 'deadline'], [0.28, 'verdict proposed'], [0.76, 'final'], [0.93, 'payouts']];
  // where the playhead is
  let f;
  if (t < T.PROPOSE) f = 0.28 * prog(t, T.DEAD, T.PROPOSE);
  else if (t < T.DISPUTE) f = 0.28;
  else f = lerp(0.28, 0.76, EASE.css(prog(t, T.DISPUTE, T.FINAL))) + 0.17 * EASE.expo(prog(t, T.FINAL + 0.1, T.PAYOUT + 0.3));
  c.save(); c.globalAlpha = a;
  c.fillStyle = rgba(PANEL2); c.fillRect(x0, y - lw / 2, x1 - x0, lw);
  c.fillStyle = rgba(CORAL); c.fillRect(x0, y - lw / 2, X(f) - x0, lw);
  // the dispute window band
  c.fillStyle = rgba(PENDING, 0.18 + 0.2 * ex); c.fillRect(X(0.28), y - lw * 1.6, X(0.76) - X(0.28), lw * 3.2);
  font(c, ls, PIXEL, 500); c.textAlign = 'center';
  text(c, '24h dispute window', (X(0.28) + X(0.76)) / 2, y - lw * 1.6 - ls * 0.6, PENDING);
  marks.forEach(([m, label]) => {
    const on = f >= m - 0.001;
    dot(c, X(m), y, lerp(6, 14, ex), on ? CORAL : DIM, on ? 12 : 0);
    text(c, label, X(m), y + lw + ls * 1.5, on ? CREAM : DIM);
  });
  // the playhead
  dot(c, X(f), y, lerp(8, 18, ex), CREAM, 16);
  c.restore();
  if (ex > 0.2) { // the big view: countdown and the bond
    c.save(); c.globalAlpha = a * prog(ex, 0.2, 1);
    const cd = [[0, '24:00:00'], [T.DISPUTE + 0.15, '18:00:00'], [T.DISPUTE + 0.3, '12:00:00'], [T.DISPUTE + 0.45, '06:00:00'], [T.DISPUTE + 0.6, '00:00:00']];
    rolling(c, cd, t, (X(0.28) + X(0.76)) / 2, y + 150, { size: 56, col: CREAM, align: 'center' });
    const bk = clamp(spring(t - T.DISPUTE - 0.2, 15, 8), 0, 1.2);
    if (bk > 0) { c.save(); c.translate((X(0.28) + X(0.76)) / 2, y + 215); c.scale(bk, bk); font(c, 30, PIXEL, 500); const bw = width(c, 'anyone can dispute with a 2 USDC bond') + 30 * 1.2; pill(c, -bw / 2, 0, 'anyone can dispute with a 2 USDC bond', { fg: PENDING, bg: RED, bga: 0.16, size: 30 }); c.restore(); }
    c.restore();
  }
}

// ── scenes and the ASCII wipe between them
function hookQ(c, t, W, H) {
  kinetic(c, t, [COPY.en.q[0]], 'slam', T.Q1, W / 2, H * 0.44, 200, 'center');
  kinetic(c, t, [COPY.en.q[1]], 'split', T.Q2, W / 2, H * 0.44 + 200, 200, 'center');
}
function hookA(c, t, W, H) {
  kinetic(c, t, [COPY.en.a[0]], 'slam', T.A1, W / 2, H * 0.44, 200, 'center');
  kinetic(c, t, ['*' + COPY.en.a[1]], 'wipe', T.A2, W / 2, H * 0.44 + 200, 200, 'center');
}
function endCard(c, t, W, H) {
  const hp = prog(t, T.HORN, T.HORN + 0.8), hs = 420, hx = W / 2, hy = H * 0.36;
  const glow = EASE.expo(prog(t, T.HORN, T.HORN + 1.4));
  if (glow > 0) {
    const g = c.createRadialGradient(hx, hy, 0, hx, hy, hs * 1.15);
    g.addColorStop(0, `rgba(255,43,43,${0.30 * glow})`); g.addColorStop(0.55, `rgba(143,14,23,${0.14 * glow})`); g.addColorStop(1, 'rgba(17,15,14,0)');
    c.fillStyle = g; c.fillRect(hx - hs * 1.2, hy - hs * 1.2, hs * 2.4, hs * 2.4);
  }
  const drift = Math.sin((t - T.HORN) * 1.1) * 4;
  dither(c, hp, g => { const hw = hs * (1148 / 1256); g.save(); g.shadowColor = 'rgba(255,43,43,0.35)'; g.shadowBlur = 40; g.drawImage(img.horn, hx - hw / 2, hy - hs / 2 + drift, hw, hs); g.restore(); }, { cell: 8, rise: 40, second: true });
  const base = H * 0.8;
  dither(c, prog(t, T.SLOGAN, T.SLOGAN + 0.5), g => slogan(g, W / 2, base, 150, prog(t, T.SCRIB, T.SCRIB + 0.65), COPY.en.lead, COPY.en.accent), { cell: 8, rise: 30, second: true });
  dither(c, prog(t, T.URL, T.URL + 0.5), g => { font(g, 46, MONO, 500); g.textAlign = 'center'; text(g, COPY.en.url, W / 2, base + 96, MUTED); g.textAlign = 'left'; }, { cell: 4, rise: 16, second: true });
}
function mainScene(c, t, W, H) {
  worldScene(c, t, W, H);
  const pre = t < T.PROPOSE + 0.3 ? 1 : 1 - prog(t, T.PROPOSE + 0.3, T.PROPOSE + 0.6);
  scrim(c, W, H, pre);
  WORDS().forEach(([a, b, lines, style, sub]) => {
    const p = life(t, a, 0.01, b - 0.12, 0.2);
    if (p <= 0) return;
    dither(c, p, g => {
      kinetic(g, t, lines, style, a, 110, 300, 132);
      font(g, 28, PIXEL, 500); g.textAlign = 'left'; text(g, sub, 114, 300 + lines.length * 132 * 0.98 - 40, MUTED, prog(t, a + 0.25, a + 0.5));
    }, { cell: 6, rise: 0, second: true });
  });
  // the takeover: "It only proposes."
  const pp = life(t, T.PROPOSE + 0.5, 0.01, T.END + 1, 0.2);
  if (pp > 0) dither(c, pp, g => kinetic(g, t, ['It only', '*proposes.'], 'slam', T.PROPOSE + 0.5, W / 2, H * 0.26, 140, 'center'), { cell: 6, rise: 0, second: true });
  scrubber(c, t, W, H, prog(t, T.DEAD, T.DEAD + 0.3));
  terminal(c, t, W, H, prog(t, T.DEAD - 0.1, T.DEAD + 0.2) * (1 - prog(t, T.PROPOSE + 0.6, T.PROPOSE + 0.9) * 0.6));
}
const SCENES = [hookQ, hookA, mainScene, endCard];
const WIPES = () => [T.WIPE1, T.WIPE2, T.END];
const WIPE_DUR = 0.5;
function sceneAt(t) { const w = WIPES(); let i = 0; w.forEach((a, k) => { if (t >= a + WIPE_DUR / 2) i = k + 1; }); return i; }

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
    const { W, H } = api;
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, rgba(INK)); bg.addColorStop(1, rgba(INK_DEEP));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const frame = t * 24;
    const [sx, sy] = shake(t, [[T.Q1, 6], [T.A1, 6], [T.DEAD, 7], [T.REFUND, 4], [T.PROPOSE + 0.5, 6]]);
    ctx.save(); ctx.translate(sx, sy);
    // a quiet field at the edges of the hook and the end card only
    const edge = (1 - prog(t, T.WIPE2, T.WIPE2 + 0.3)) + prog(t, T.END, T.END + 0.6);
    if (edge > 0) field(ctx, frame, 0.32 * clamp(edge), heroMask);
    // the wipe: the ASCII field is the seam that carries one scene into the next
    const wipes = WIPES(), wi = wipes.findIndex(a => t >= a && t < a + WIPE_DUR);
    if (wi < 0) SCENES[sceneAt(t)](ctx, t, W, H);
    else {
      const f = E.inOutCubic(prog(t, wipes[wi], wipes[wi] + WIPE_DUR)), fx = lerp(-W * 0.12, W * 1.12, f);
      ctx.save(); ctx.beginPath(); ctx.rect(fx, -50, W + 100, H + 100); ctx.clip(); SCENES[wi](ctx, t, W, H); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(-50, -50, fx + 50, H + 100); ctx.clip(); SCENES[wi + 1](ctx, t, W, H); ctx.restore();
      ctx.fillStyle = 'rgba(10,8,8,0.85)'; ctx.fillRect(fx - W * 0.07, 0, W * 0.14, H);
      field(ctx, frame, 1, (u, v) => clamp(1 - Math.abs(u * W - fx) / (W * 0.08)) * (0.75 + 0.25 * Math.sin(v * 40 + frame * 0.3)));
    }
    ctx.restore();
  },

  post(ctx, t, { W, H }) { vignette(ctx, W, H, 0.26); },
};
