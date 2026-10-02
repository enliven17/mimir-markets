// Mimir architecture (28 s, 120 BPM, bar = 2 s). Act 1, "How Mimir works today": the stack builds layer by
// layer (traders and agents, the Next.js app, the MagicBlock Ephemeral Rollup, the Anchor V3 program, the AI
// workers, the data they read), boxes tracing in and connectors carrying packets. Act 2, "Next: Jev": a planned
// layer of typed, calibrated decisions slides in under the workers with three hookups (oracle second opinion,
// council stakes, moderation and claim quality), then the calibration note and the end card. Labels follow
// README.md, docs/SOLANA.md, docs/COUNCIL.md and the code; everything in act 2 is marked as planned.
// Layout reads from `api.W` / `api.H`; project.json is the 1920×1080 cut.
// The illustrative numbers (Jev's probabilities, the score) are placeholders, not output.
import { TAU, prog, rgba, E, EASE, spring, setFont, clamp, lerp, shake, vignette, rrect } from '../../engine/core.js';

// ── tokens (app/globals.css)
const INK = [17, 15, 14], INK_DEEP = [10, 8, 8], PANEL2 = [39, 33, 32], CREAM = [243, 234, 214], MUTED = [168, 157, 147];
const DIM = [146, 135, 128], RED = [255, 43, 43], CORAL = [255, 81, 72], WIN = [159, 214, 168], PENDING = [255, 179, 173];
const GLASS_CARD = 'rgba(28,20,21,0.93)';
const DISPLAY = "'Terminal Grotesque'", PIXEL = "'Geist Pixel Square'", MONO = "'Geist Mono'";

// ── copy (the caption track)
const COPY = {
  en: {
    eb1: 'Architecture · live on devnet', title1: 'How Mimir works today.',
    eb2: 'Coming next · planned', title2: 'Next: Jev.', sub2: "TypeSafe AI's decision model",
    end: ['Mimir × Jev.', 'Coming soon.'], url: 'mimirmarkets.xyz',
  },
};

// ── the stack today (README.md, docs/SOLANA.md, docs/COUNCIL.md)
const LAYERS = [
  { name: 'Traders and agents', sub: 'humans and AI, one market', w: [1, 1, 1], boxes: [
    ['Phantom / Solflare', 'connect, deposit, sign'],
    ['BYOA agent API + SDK', 'REST, Node SDK, webhooks'],
    ['Baskets + copy trading', 'follow a basket or a wallet']] },
  { name: 'Next.js app', sub: 'mimirmarkets.xyz', w: [1, 1, 1], boxes: [
    ['Arena feed', 'reads the ER first, then Solana'],
    ['Challenges', 'signed in the browser'],
    ['/verify', 're-hash any verdict bundle']] },
  { name: 'MagicBlock Ephemeral Rollup', sub: 'real time, zero fee', w: [1, 1, 1], boxes: [
    ['Delegated claims + balances', 'claim and balance PDAs'],
    ['Zero-fee challenges', '~30 ms each'],
    ['Commit back to Solana', 'at the deadline']] },
  { name: 'Solana program', sub: 'Anchor V3 · devnet', w: [1, 1, 1], boxes: [
    ['USDC vault + claim PDAs', 'one escrow for every stake'],
    ['Optimistic resolution', '24h dispute, 2 USDC bond'],
    ['Pull payouts + refunds', 'cranked, no payout loops']] },
  { name: 'AI workers', sub: 'off-chain', w: [1.9, 1, 1.05, 0.85], boxes: [
    ['Oracle', 'evidence fetch, resolver specs, two price sources, LLM, audit hash on chain'],
    ['Market creator', 'crypto, sports, stocks, Polymarket'],
    ['Council · 20 personas', 'Kelly-sized stakes, jury'],
    ['Indexer', 'chain → Neon read index']] },
];
const SOURCES = ['Flash Trade', 'CoinGecko', 'Chainlink', 'DexScreener', 'ESPN', 'Polymarket'];
const LLM_CHAIN = 'Gemini → Groq → OpenRouter';
// [gap (row i to i+1; 4 = workers to the data strip), row, col, direction, label]
const LINKS = [
  [0, 0, 1, 'down', 'connect · sign · REST'],
  [1, 1, 1, 'down', 'challenge_claim on the ER'],
  [2, 2, 2, 'down', 'commit + undelegate'],
  [3, 4, 0, 'up', 'create · propose · finalize · crank'],
  [3, 4, 3, 'down', 'mirror'],
  [4, 4, 0, 'up', 'evidence + prices'],
];

// ── next: Jev (planned). Boxes sit under the worker they serve: [worker col, title, kind]
const JEV = [
  { col: 0, title: 'Oracle second opinion', link: 'verdict check' },
  { col: 1, title: 'Moderation + claim quality', link: 'score' },
  { col: 2, title: 'Council stakes', link: 'probability' },
];
const CHOICES = [['CREATOR', 0.06], ['CHALLENGERS', 0.91], ['UNRESOLVABLE', 0.03]]; // illustration
const OUTCOMES = [
  { jev: 0, eb: 'Hookup 1 / 3 · oracle second opinion', l1: 'LLM verdict + Jev choice.', l2: 'Agree: FIRM. Disagree: CONTESTED or refund.', l3: 'The LLM still writes the rationale for the audit bundle.' },
  { jev: 2, eb: 'Hookup 2 / 3 · council stakes', l1: 'Calibrated probability', l2: '→ Kelly size.', l3: 'Personas stake on a typed number, not free text.' },
  { jev: 1, eb: 'Hookup 3 / 3 · moderation and claim quality', l1: 'Score / yes-no', l2: 'on every claim.', l3: 'Checked before a claim goes live.' },
  { jev: -1, eb: 'Calibration', l1: 'Measured on /calibration', l2: 'with Brier scores.', l3: 'Planned. Not live yet.' },
];

// ── beat grid (sound.py mirrors these)
const T = {};
function times(at) {
  Object.assign(T, {
    TITLE: at(0, 1), SRC: at(5, 8), LLM: at(5, 14),
    ACT2: at(7), JEV: at(7, 4), HOOK0: at(8), CAL: at(11, 8),
    END: at(12, 4), HORN: at(12, 6), LINE: at(12, 12), SCRIB: at(13, 2), URL: at(13, 4),
  });
  T.layerAt = i => at(0, 12) + i * at(1); // 1.5, 3.5, 5.5, 7.5, 9.5
  T.boxAt = (i, j) => T.layerAt(i) + 0.25 + j * at(0, 2);
  T.hookAt = k => [at(8), at(9, 4), at(10, 8), at(11, 8)][k];
  T.chipAt = k => T.SRC + 0.1 + k * at(0, 1);
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

// ── layout
function layoutFor(W, H) {
  if (W / H > 1.3) {
    return { wide: true, field: 16, head: { x: 100, eb: 88, ty: 160, ts: 78, subSz: 30 },
      lx: 100, lw: 410, bx: 560, bw: 1260, rowY: i => 200 + i * 152, boxOff: 0, boxH: 112,
      strip: { y: 960, h: 76 }, tSz: 26, sSz: 18, sLH: 23, pad: 20, linkSz: 18, numSz: 66, nameCap: 40, layerSubSz: 20,
      workY: 250, jevY: 600, jevH: 150, out: { x: 100, y: 800, w: 1720, h: 230, l: 52, l3: 26 },
      horn: 420, end: 150, urlSz: 46 };
  }
  return { wide: false, field: 14, head: { x: 60, eb: 62, ty: 126, ts: 60, subSz: 24 },
    lx: 60, lw: 960, bx: 60, bw: 960, rowY: i => 172 + i * 146, boxOff: 40, boxH: 80,
    strip: { y: 908, h: 132 }, tSz: 19, sSz: 13, sLH: 16, pad: 13, linkSz: 14, numSz: 30, nameCap: 30, layerSubSz: 17,
    workY: 196, jevY: 424, jevH: 200, out: { x: 60, y: 668, w: 960, h: 370, l: 50, l3: 24 },
    horn: 360, end: 110, urlSz: 42 };
}
/** Box columns across the box area, by weight. */
function cols(S, weights) {
  const gap = 16, total = S.bw - gap * (weights.length - 1), sum = weights.reduce((a, b) => a + b, 0);
  let x = S.bx;
  return weights.map(w => { const r = { x, w: total * w / sum }; x += r.w + gap; return r; });
}
function wrapText(c, s, maxW) {
  const words = s.split(' '), out = [];
  let cur = '';
  for (const w of words) { const n = cur ? `${cur} ${w}` : w; if (width(c, n) > maxW && cur) { out.push(cur); cur = w; } else cur = n; }
  if (cur) out.push(cur);
  return out;
}

/** A box that traces its outline in, fills, then types its title. Returns its rect. */
function box(c, t, t0, x, y, w, h, title, sub, S, { hot = 0, accent = CORAL } = {}) {
  const p = prog(t, t0, t0 + 0.35);
  if (p <= 0) return;
  const per = 2 * (w + h);
  const fill = prog(t, t0 + 0.12, t0 + 0.4);
  c.save();
  if (fill > 0) { c.globalAlpha = fill; c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 30; c.shadowOffsetY = 12; rrect(c, x, y, w, h, 14); c.fillStyle = GLASS_CARD; c.fill(); }
  c.restore();
  c.save();
  if (hot > 0) { c.shadowColor = rgba(accent, 0.7 * hot); c.shadowBlur = 26 * hot; }
  c.setLineDash([per * EASE.expo(p), per]); c.lineWidth = 2; c.strokeStyle = rgba(accent, 0.35 + 0.55 * Math.max(hot, 1 - fill));
  rrect(c, x, y, w, h, 14); c.stroke(); c.restore();
  const tp = prog(t, t0 + 0.2, t0 + 0.45);
  if (tp <= 0) return;
  const pad = S.pad;
  font(c, S.tSz, PIXEL, 500);
  let ts = S.tSz; while (width(c, title) > w - pad * 2 && ts > 12) { ts -= 1; font(c, ts, PIXEL, 500); }
  c.textAlign = 'left';
  text(c, title.slice(0, Math.ceil(title.length * tp)), x + pad, y + pad + ts * 0.85, CREAM);
  if (sub) {
    font(c, S.sSz, MONO);
    wrapText(c, sub, w - pad * 2).slice(0, 3).forEach((l, i) => text(c, l, x + pad, y + pad + ts * 0.85 + S.sLH * (i + 1.25), MUTED, prog(t, t0 + 0.3, t0 + 0.55)));
  }
}

/** A vertical connector that grows from a to b, with packets flowing along it and a label pill beside it. */
function connector(c, t, t0, x, ya, yb, label, S, { hot = 1, col = CORAL, both = false } = {}) {
  const g = EASE.expo(prog(t, t0, t0 + 0.35));
  if (g <= 0) return;
  const y1 = lerp(ya, yb, g), dir = Math.sign(yb - ya);
  c.save();
  c.strokeStyle = rgba(col, 0.25 + 0.45 * hot); c.lineWidth = 2; c.setLineDash([5, 5]); c.lineDashOffset = -t * 30 * dir;
  c.beginPath(); c.moveTo(x, ya); c.lineTo(x, y1); c.stroke(); c.setLineDash([]);
  // arrow head
  if (g > 0.9) { c.fillStyle = rgba(col, 0.5 + 0.5 * hot); c.beginPath(); c.moveTo(x - 6, yb - dir * 9); c.lineTo(x + 6, yb - dir * 9); c.lineTo(x, yb); c.closePath(); c.fill(); }
  // packets
  if (g >= 1) {
    const n = 2, len = Math.abs(yb - ya), sp = Math.max(0.5, len / 140);
    for (let k = 0; k < n; k++) {
      const f = (((t - t0) / sp + k / n) % 1 + 1) % 1, yy = lerp(ya, yb, f);
      c.save(); c.shadowColor = rgba(col, 0.9); c.shadowBlur = 12; c.fillStyle = rgba(k % 2 && both ? CREAM : col, 0.4 + 0.6 * hot);
      c.fillRect(x - 4, yy - 4, 8, 8); c.restore();
    }
    if (both) {
      for (let k = 0; k < n; k++) {
        const f = (((t - t0) / sp + k / n + 0.25) % 1 + 1) % 1, yy = lerp(yb, ya, f);
        c.save(); c.shadowColor = rgba(CREAM, 0.8); c.shadowBlur = 10; c.fillStyle = rgba(CREAM, 0.4 + 0.6 * hot); c.fillRect(x - 3, yy - 3, 6, 6); c.restore();
      }
    }
  }
  c.restore();
  if (label) {
    const lp = prog(t, t0 + 0.2, t0 + 0.5);
    if (lp > 0) { c.save(); c.globalAlpha = lp * (0.55 + 0.45 * hot); pill(c, x + 14, (ya + yb) / 2, label, { fg: PENDING, bg: CORAL, bga: 0.12, size: S.linkSz }); c.restore(); }
  }
}

/** A layer's label: number + name (+ sub), to the left of its boxes (16:9) or above them (1:1). */
function layerLabel(c, t, t0, S, rowTop, num, name, sub, hot) {
  const a = prog(t, t0, t0 + 0.3);
  if (a <= 0) return;
  c.save(); c.globalAlpha = a; c.textAlign = 'left';
  if (S.wide) {
    const cy = rowTop + S.boxH / 2;
    if (hot > 0) { const g = c.createRadialGradient(S.lx + 20, cy, 0, S.lx + 20, cy, 90); g.addColorStop(0, `rgba(255,43,43,${0.16 * hot})`); g.addColorStop(1, 'rgba(255,43,43,0)'); c.fillStyle = g; c.fillRect(S.lx - 80, cy - 90, 180, 180); }
    display(c, S.numSz); text(c, num, S.lx, cy + S.numSz * 0.34, RED);
    const nx = S.lx + 66, fs = fitSize(c, [name], S.lw - 66, S.nameCap);
    display(c, fs); text(c, name, nx, cy + 4, CREAM);
    font(c, S.layerSubSz, PIXEL, 500); text(c, sub, nx, cy + 34, hot > 0 ? PENDING : MUTED);
  } else {
    const by = rowTop + 28;
    display(c, S.numSz); text(c, num, S.lx, by, RED);
    const nx = S.lx + 30; display(c, S.nameCap); text(c, name, nx, by, CREAM);
    const nw = width(c, name);
    font(c, S.layerSubSz, PIXEL, 500); text(c, `· ${sub}`, nx + nw + 12, by - 2, hot > 0 ? PENDING : DIM);
  }
  c.restore();
}

/** One row of the stack at rowTop. */
function layerRow(c, t, i, rowTop, S, hot) {
  const L = LAYERS[i], t0 = T.layerAt(i), cs = cols(S, L.w), by = rowTop + S.boxOff;
  layerLabel(c, t, t0, S, rowTop, String(i + 1), L.name, L.sub, hot);
  L.boxes.forEach(([ti, su], j) => box(c, t, T.boxAt(i, j), cs[j].x, by, cs[j].w, S.boxH, ti, su, S, { hot: hot * 0.6 }));
}

/** The data the workers read: sources and the LLM fallback chain. */
function dataStrip(c, t, S) {
  const { y, h } = S.strip, a = prog(t, T.SRC, T.SRC + 0.3);
  if (a <= 0) return;
  c.save(); c.globalAlpha = a; c.textAlign = 'left';
  const lp = prog(t, T.LLM, T.LLM + 0.3);
  if (S.wide) {
    dot(c, S.lx + 6, y + 22, 6, RED);
    font(c, 22, PIXEL, 500, 1.2); text(c, 'DATA IN', S.lx + 22, y + 30, RED);
    font(c, 20, MONO); text(c, 'LLM', S.lx, y + 66, DIM, lp); text(c, LLM_CHAIN.slice(0, Math.ceil(LLM_CHAIN.length * lp)), S.lx + 52, y + 66, CREAM);
  } else {
    dot(c, S.lx + 6, y + 20, 6, RED);
    font(c, 18, PIXEL, 500, 1.2); text(c, 'DATA IN', S.lx + 22, y + 26, RED);
    font(c, 18, MONO); text(c, 'LLM', S.lx, y + 112, DIM, lp); text(c, LLM_CHAIN.slice(0, Math.ceil(LLM_CHAIN.length * lp)), S.lx + 46, y + 112, CREAM);
  }
  c.restore();
  // source chips
  const size = S.wide ? 22 : 17;
  let x = S.wide ? S.bx : S.lx, cy = S.wide ? y + 38 : y + 66;
  SOURCES.forEach((s, k) => {
    const age = t - T.chipAt(k);
    font(c, size, PIXEL, 500);
    const w = width(c, s) + size * 1.2;
    if (age >= 0) {
      const sk = clamp(spring(age, 16, 8), 0, 1.2);
      c.save(); c.translate(x + w / 2, cy); c.scale(sk, sk); c.translate(-w / 2, 0);
      pill(c, 0, 0, s, { fg: CREAM, bg: CREAM, bga: 0.08, size }); c.restore();
    }
    x += w + 12;
  });
}

/** Act 2: a Jev box, with its typed output. */
function jevBox(c, t, k, x, y, w, h, S, hot) {
  const J = JEV[k], t0 = T.JEV + 0.35 + k * 0.125;
  box(c, t, t0, x, y, w, h, J.title, null, S, { hot, accent: RED });
  const a = prog(t, t0 + 0.3, t0 + 0.6);
  if (a <= 0) return;
  const pad = S.pad, sz = S.wide ? 18 : 13, top = y + pad + S.tSz * 0.85;
  c.save(); c.globalAlpha = a; c.textAlign = 'left';
  pill(c, x + w - pad, y - 1, 'planned', { fg: PENDING, bg: RED, bga: 0.22, size: S.wide ? 16 : 12, align: 'right' });
  const on = k === 0 ? prog(t, T.hookAt(0) + 0.3, T.hookAt(0) + 0.9) : k === 2 ? prog(t, T.hookAt(1) + 0.3, T.hookAt(1) + 0.8) : prog(t, T.hookAt(2) + 0.3, T.hookAt(2) + 0.8);
  if (k === 0) { // typed choice with probabilities
    CHOICES.forEach(([name, p], i) => {
      const yy = top + (S.wide ? 34 : 26) + i * (S.wide ? 28 : 22);
      font(c, sz, MONO); text(c, name, x + pad, yy, i === 1 ? CREAM : MUTED);
      const bx = x + pad + (S.wide ? 170 : 116), bw = w - pad * 2 - (S.wide ? 170 : 116) - (S.wide ? 56 : 40);
      rrect(c, bx, yy - sz * 0.7, bw, sz * 0.6, 3); c.fillStyle = rgba(PANEL2); c.fill();
      rrect(c, bx, yy - sz * 0.7, Math.max(4, bw * p * EASE.expo(on)), sz * 0.6, 3); c.fillStyle = rgba(i === 1 ? CORAL : DIM); c.fill();
      c.textAlign = 'right'; text(c, (p * on).toFixed(2), x + w - pad, yy, i === 1 ? CORAL : MUTED); c.textAlign = 'left';
    });
  } else if (k === 2) {
    font(c, sz + 4, MONO, 500); text(c, `p ${(0.64 * on).toFixed(2)}`, x + pad, top + (S.wide ? 46 : 34), CREAM);
    font(c, sz, MONO); text(c, '→ Kelly size', x + pad, top + (S.wide ? 78 : 58), CORAL, on);
  } else {
    font(c, sz + 4, MONO, 500); text(c, `Score ${Math.round(82 * on)}`, x + pad, top + (S.wide ? 46 : 34), CREAM);
    font(c, sz, MONO); text(c, 'yes / no', x + pad, top + (S.wide ? 78 : 58), CORAL, on);
  }
  c.restore();
}

/** Act 2: the outcome panel for the active hookup. */
function outcome(c, t, S) {
  const O = S.out;
  card(c, O.x, O.y, O.w, O.h, 22, 'rgba(16,10,11,0.95)');
  OUTCOMES.forEach((o, k) => {
    const a0 = T.hookAt(k), a1 = k < 3 ? T.hookAt(k + 1) : T.END + 1;
    const p = life(t, a0 + 0.1, 0.35, a1 - 0.05, 0.2);
    if (p <= 0) return;
    dither(c, p, g => {
      const pad = S.wide ? 44 : 34;
      dot(g, O.x + pad + 6, O.y + 46 - 9, 6, RED);
      font(g, S.wide ? 24 : 20, PIXEL, 500, 1.2); g.textAlign = 'left'; text(g, o.eb.toUpperCase(), O.x + pad + 24, O.y + 46, RED);
      const fs = fitSize(g, [o.l1, o.l2], O.w - pad * 2, O.l), y1 = O.y + 46 + fs * 1.15, y2 = y1 + fs;
      display(g, fs); line(g, o.l1, O.x + pad, y1, CREAM); line(g, o.l2, O.x + pad, y2, RED);
      font(g, O.l3, PIXEL, 500); text(g, o.l3, O.x + pad, y2 + O.l3 + (S.wide ? 16 : 28), MUTED);
    }, { cell: 5, rise: 16, second: true });
  });
}

/** The header: eyebrow + title (act 1, then act 2). */
function header(c, t, S, eb, title, sub) {
  const H = S.head;
  dot(c, H.x + 6, H.eb - 9, 6, RED);
  font(c, S.wide ? 24 : 20, PIXEL, 500, 1.3); c.textAlign = 'left'; text(c, eb.toUpperCase(), H.x + 24, H.eb, RED);
  display(c, H.ts); line(c, title, H.x, H.ty, CREAM);
  if (sub) {
    const tw = width(c, title);
    font(c, H.subSz, PIXEL, 500);
    if (S.wide) text(c, sub, H.x + tw + 30, H.ty - 6, MUTED); else text(c, sub, H.x + tw + 20, H.ty - 4, MUTED);
  }
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
  },

  draw(ctx, t, api) {
    const { W, H } = api, C = COPY[api.lang] ?? COPY.en, S = layoutFor(W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, rgba(INK)); bg.addColorStop(1, rgba(INK_DEEP));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const frame = t * 24;
    const [sx, sy] = shake(t, [[T.JEV, 5], [T.LINE, 6]]);
    ctx.save(); ctx.translate(sx, sy);

    // the field: faint behind the build, full on the end card
    const f1 = prog(t, 0, 1) * (1 - prog(t, T.layerAt(0), T.layerAt(0) + 1.2) * 0.75) * (1 - prog(t, T.END - 0.4, T.END));
    if (f1 > 0) field(ctx, frame, 0.6 * f1, heroMask);
    const endField = prog(t, T.END + 0.1, T.HORN + 0.8);
    if (endField > 0) field(ctx, frame, 0.5 * endField, endMask);

    const all = life(t, 0, 0.01, T.END, 0.35);
    if (all > 0) {
      // header: act 1, then act 2
      dither(ctx, life(t, T.TITLE, 0.4, T.ACT2, 0.25), c => header(c, t, S, C.eb1, C.title1), { cell: 7, rise: 20, second: true });
      dither(ctx, Math.min(prog(t, T.ACT2 + 0.2, T.ACT2 + 0.6), all), c => header(c, t, S, C.eb2, C.title2, C.sub2), { cell: 7, rise: 20, second: true });

      // act 1: layers 1 to 4, the links between them, the data strip; they leave at ACT2
      const act1 = 1 - prog(t, T.ACT2, T.ACT2 + 0.35);
      const hotOf = i => (t >= T.layerAt(i) && t < T.layerAt(i) + 2 ? 1 - prog(t, T.layerAt(i) + 1.4, T.layerAt(i) + 2) : 0);
      if (act1 > 0) dither(ctx, act1, c => {
        for (let i = 0; i < 4; i++) layerRow(c, t, i, S.rowY(i), S, hotOf(i));
        LINKS.forEach(([gap, row, col, dir, label]) => {
          if (gap === 3 && row === 4) return; // drawn with the workers row
          if (gap === 4) return;
          const cs = cols(S, LAYERS[row].w), x = cs[col].x + cs[col].w / 2;
          const top = S.rowY(gap) + S.boxOff + S.boxH, bot = S.rowY(gap + 1);
          connector(c, t, T.layerAt(gap + 1) + 0.05, x, dir === 'down' ? top : bot, dir === 'down' ? bot : top, label, S);
        });
        dataStrip(c, t, S);
        // workers ⇄ program, and data → oracle
        const cs4 = cols(S, LAYERS[4].w);
        LINKS.filter(l => l[0] >= 3).forEach(([gap, row, col, dir, label]) => {
          const x = cs4[col].x + cs4[col].w / 2;
          const top = gap === 3 ? S.rowY(3) + S.boxOff + S.boxH : S.rowY(4) + S.boxOff + S.boxH, bot = gap === 3 ? S.rowY(4) : S.strip.y;
          const t0 = gap === 3 ? T.layerAt(4) + 0.6 + col * 0.06 : T.SRC + 0.3;
          connector(c, t, t0, x, dir === 'down' ? top : bot, dir === 'down' ? bot : top, label, S);
        });
      }, { cell: 6, rise: 0 });

      // the workers row stays, and moves up for act 2
      const mv = EASE.expo(prog(t, T.ACT2 + 0.1, T.ACT2 + 0.8)), wy = lerp(S.rowY(4), S.workY, mv);
      dither(ctx, Math.min(prog(t, T.layerAt(4), T.layerAt(4) + 0.3), all), c => layerRow(c, t, 4, wy, S, Math.max(hotOf(4), 0)), { cell: 6, rise: 0 });

      // act 2: the Jev layer slides in, three hookups, the outcome panel
      if (t >= T.JEV) {
        const sp = EASE.expo(prog(t, T.JEV, T.JEV + 0.7)), jy = S.jevY + (1 - sp) * 160;
        dither(ctx, Math.min(prog(t, T.JEV, T.JEV + 0.5), all), c => {
          // label
          c.save(); c.textAlign = 'left';
          if (S.wide) {
            const cy = jy + S.jevH / 2;
            display(c, 76); text(c, 'Jev', S.lx, cy + 4, CREAM); text(c, '.', S.lx + width(c, 'Jev'), cy + 4, RED);
            font(c, 22, PIXEL, 500); text(c, 'typed choice, probability,', S.lx, cy + 40, MUTED); text(c, 'confidence. No free text.', S.lx, cy + 68, MUTED);
            pill(c, S.lx, cy - 74, 'COMING NEXT', { fg: PENDING, bg: RED, bga: 0.22, size: 20, dotCol: RED });
          } else {
            display(c, 36); text(c, 'Jev', S.lx, jy + 28, CREAM); const jw = width(c, 'Jev'); text(c, '.', S.lx + jw, jy + 28, RED);
            font(c, 17, PIXEL, 500); text(c, '· typed choice, probability, confidence', S.lx + jw + 26, jy + 26, MUTED);
            pill(c, S.lx + S.lw, jy + 18, 'COMING NEXT', { fg: PENDING, bg: RED, bga: 0.22, size: 16, dotCol: RED, align: 'right' });
          }
          c.restore();
          const cs4 = cols(S, LAYERS[4].w), by = jy + S.boxOff, bh = S.jevH - S.boxOff;
          const active = k => { const idx = OUTCOMES.findIndex(o => o.jev === k); const a0 = T.hookAt(idx), a1 = T.hookAt(idx + 1); return t >= a0 && t < a1 ? 1 : t >= T.CAL ? 0.6 : 0.25; };
          JEV.forEach((J, k) => {
            const r = cs4[J.col], hot = t >= T.HOOK0 ? active(k) : 0;
            // the hookup: worker ⇄ Jev, packets both ways while active
            connector(c, t, T.JEV + 0.6 + k * 0.1, r.x + r.w / 2, wy + S.boxOff + S.boxH, by, J.link, S, { hot, col: RED, both: hot >= 1 });
            jevBox(c, t, k, r.x, by, r.w, bh, S, hot >= 1 ? 1 : 0);
          });
        }, { cell: 6, rise: 0 });
        dither(ctx, Math.min(prog(t, T.HOOK0, T.HOOK0 + 0.4), all), c => outcome(c, t, S), { cell: 6, rise: 24 });
      }
    }

    // ── end card: the horn, "Mimir × Jev. Coming soon.", the URL
    if (t >= T.END) {
      const hp = prog(t, T.HORN, T.HORN + 0.8), hs = S.horn, hx = W / 2, hy = H * 0.34;
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
      const base = H * 0.77, fs = fitSize(ctx, [C.end.join(' ')], W - 120, S.end), k = clamp(spring(t - T.LINE, 13, 8), 0, 1.15);
      dither(ctx, prog(t, T.LINE, T.LINE + 0.5), c => {
        c.save(); c.translate(W / 2, base); c.scale(lerp(1.1, 1, k), lerp(1.1, 1, k));
        slogan(c, 0, 0, fs, prog(t, T.SCRIB, T.SCRIB + 0.65), C.end[0], C.end[1]);
        c.restore();
      }, { cell: 8, rise: 30 });
      dither(ctx, prog(t, T.URL, T.URL + 0.5), c => { font(c, S.urlSz, MONO, 500); c.textAlign = 'center'; text(c, C.url, W / 2, base + fs * 0.62 + 20, MUTED); c.textAlign = 'left'; }, { cell: 4, rise: 16 });
    }
    ctx.restore();
  },

  post(ctx, t, { W, H }) { vignette(ctx, W, H, 0.26); },
};
