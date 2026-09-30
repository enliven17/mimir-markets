// Mimir launch (16:9, 20 s, 120 BPM, bar = 2 s): the hero's slogan over the ASCII wave field, then one claim
// card walks the four steps of "How it settles" (Create → Challenge → Resolve → Payout) with the council
// voting inside Resolve, then the horn and the slogan. Pieces are the site's own: tokens from app/globals.css,
// the field from components/hero-ascii/field.ts, the scribble from components/landing/Scribble.tsx, the dither
// from components/motion/useDitherReveal.ts, the card and odds bar from components/arena/ClaimCard.tsx + OddsBar.tsx.
// Layout reads from `api.W` / `api.H`, so the same scene renders the 1080×1080 cut (project.square.json).
import { TAU, prog, rgba, E, EASE, spring, setFont, clamp, lerp, hash, shake, vignette, rrect } from '../../engine/core.js';

// ── tokens (app/globals.css)
const INK = [17, 15, 14], INK_DEEP = [10, 8, 8], PANEL2 = [39, 33, 32], CREAM = [243, 234, 214], MUTED = [168, 157, 147];
const DIM = [146, 135, 128], RED = [255, 43, 43], CORAL = [255, 81, 72], WIN = [159, 214, 168], PENDING = [255, 179, 173];
const GLASS_CARD = 'rgba(28,20,21,0.93)';
const DISPLAY = "'Terminal Grotesque'", PIXEL = "'Geist Pixel Square'", MONO = "'Geist Mono'";

// ── copy (few words per scene)
const COPY = {
  en: {
    lead: "Don't argue.", accent: 'Settle.',
    steps: ['Create', 'Challenge', 'Resolve', 'Payout'],
    subs: ['Stake USDC on one side.', 'Zero fee, in the rollup.', 'The oracle reads the evidence.', 'Winners pull their USDC.'],
    council: 'The council votes.',
    url: 'mimirmarkets.xyz',
  },
};

// ── the claim (illustration: question, wallets, stakes, price and hash are placeholders)
const CLAIM = { id: 18, category: 'Crypto', q: ['Will SOL close above', '$200 on Oct 31?'], yes: 'Yes', no: 'No' };
const CREATOR = { addr: '4hKd…9Pdq', stake: 200 };
const STAKES = [
  ['7xQm…3fa1', 25, 28], ['Bv2k…Hq7c', 40, 31], ['9Lzt…w0Ra', 15, 27], ['Fm4e…pX2s', 60, 30],
  ['2cYn…Td8u', 30, 29], ['Hs6q…Ke1m', 50, 32], ['Qa7r…Zn4v', 20, 28], ['Ek3w…Jm5b', 35, 30],
]; // [wallet, USDC, ms]
const EVIDENCE = [
  ['source', 'coingecko.com/en/coins/solana'],
  ['close', '$187.42 · Oct 31 00:00 UTC'],
  ['rule', 'close > $200  →  false'],
];
const HASH = '9f3c…a41e';
const JURY = {
  classic: ['optimist', 'pessimist', 'contrarian', 'statistician', 'whale-watcher', 'crypto-maxi', 'sports-pundit', 'weatherman', 'doomer', 'yapper'],
  philosopher: ['socrates', 'kahneman', 'taleb', 'feynman', 'munger', 'ada', 'meadows', 'machiavelli', 'aurelius', 'lao-tzu'],
};
const YES_VOTES = new Set(['optimist', 'crypto-maxi', 'yapper']);

// ── derived numbers (pool odds, pari-mutuel)
const CUM = STAKES.reduce((a, s) => [...a, (a.at(-1) ?? 0) + s[1]], []);
const CH_TOTAL = CUM.at(-1), POOL = CREATOR.stake + CH_TOTAL, MULT = POOL / CH_TOTAL;
const PAYOUTS = [3, 5, 1, 7].map(i => ({ w: i, addr: STAKES[i][0], stake: STAKES[i][1], out: STAKES[i][1] * MULT }));

// ── beat grid: every event on a bar or a 16th (sound.py mirrors these)
const T = {};
function times(at) {
  Object.assign(T, {
    SCRIB: at(0, 11), HERO_OUT: at(1, 8), CARD: at(1, 10), CREATOR: at(1, 14),
    CHALLENGE: at(2, 8), STAKE0: at(2, 10), CLOSE: at(4), RESOLVE: at(4, 4), EVID: at(4, 6),
    VERDICT: at(5), CONF: at(5, 2), HASH: at(5, 4), DISPUTE: at(5, 6), COUNCIL: at(5, 12), VOTE0: at(6),
    FIRM: at(6, 10), PAYOUT: at(7), PULL0: at(7, 4), END: at(8, 4), HORN: at(8, 6), SLOGAN: at(8, 10), URL: at(9),
  });
  T.stakeAt = i => T.STAKE0 + i * 2 * (at(0, 1));
  T.voteAt = i => T.VOTE0 + i * 0.5 * at(0, 1);
  T.popAt = i => T.COUNCIL + 0.12 + i * 0.03;
  T.pullAt = i => T.PULL0 + i * 2 * at(0, 1);
  T.rowAt = i => T.PAYOUT + 0.2 + i * at(0, 1);
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
let buf, bctx, buf2, b2ctx;
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
  if (p < 1) {
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = tiles(ctx, cell)[Math.round(clamp(p) * 64)];
    c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    c.globalCompositeOperation = 'source-over';
  }
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
/** The slogan on one line, "Settle." in red, the scribble under it. Returns nothing; centred on cx. */
function slogan(c, cx, base, fs, scribP, { align = 'center' } = {}) {
  font(c, fs, DISPLAY, 400, -0.01 * fs);
  const L = COPY.en.lead + ' ', A = COPY.en.accent, wl = width(c, L), wa = width(c, A);
  const x0 = align === 'center' ? cx - (wl + wa) / 2 : cx;
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
function avatar(c, im, x, y, d, ring = null, k = 1) {
  if (k <= 0) return;
  c.save(); c.translate(x, y); c.scale(k, k);
  const g = c.createLinearGradient(-d / 2, -d / 2, d / 2, d / 2); g.addColorStop(0, '#5b3637'); g.addColorStop(1, '#362223');
  c.beginPath(); c.arc(0, 0, d / 2, 0, TAU); c.fillStyle = g; c.fill();
  c.save(); c.clip(); if (im) c.drawImage(im, -d / 2, -d / 2, d, d); c.restore();
  c.lineWidth = 2; c.strokeStyle = ring ? rgba(ring, 0.9) : 'rgba(243,234,214,0.14)'; c.beginPath(); c.arc(0, 0, d / 2, 0, TAU); c.stroke();
  c.restore();
}
function pill(c, x, y, label, { fg = PENDING, bg = [255, 43, 43], bga = 0.14, size = 24, fam = PIXEL, dotCol = null, align = 'left' } = {}) {
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

// ── the claim's state at time t
function stakesIn(t) { let n = 0; STAKES.forEach((_, i) => { if (t >= T.stakeAt(i)) n = i + 1; }); return n; }
const poolEvents = () => [[0, '$0'], [T.CREATOR, `$${CREATOR.stake}`], ...STAKES.map((s, i) => [T.stakeAt(i), `$${CREATOR.stake + CUM[i]}`])];
const shareAt = n => (n ? CREATOR.stake / (CREATOR.stake + CUM[n - 1]) : null);
function phaseAt(t) {
  if (t >= T.PAYOUT) return ['Resolved', WIN, 0];
  if (t >= T.VERDICT) return ['Proposed', PENDING, 0];
  if (t >= T.CLOSE) return ['Awaiting verdict', PENDING, 0];
  if (t >= T.CHALLENGE) return ['Live', CORAL, 7];
  return ['Open', CORAL, 7];
}
function clockEvents() {
  const ev = [];
  for (let k = 0; k <= 9; k++) { const tt = T.CLOSE - (9 - k) * 0.5; ev.push([tt, k === 9 ? 'deadline' : `0:${String(9 - k).padStart(2, '0')} left`]); }
  ev[0][0] = 0; ev.unshift([0, '0:10 left']);
  return ev;
}

/** The claim card (ClaimCard.tsx), top-left at (x, y). */
function claimCard(c, t, x, y, w, S) {
  const h = S.cardH, pad = 48 * S.k;
  card(c, x, y, w, h);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  // header: id, or the ER pill while live; category on the right
  const er = life(t, T.CHALLENGE, 0.35, T.CLOSE, 0.3);
  if (er < 1) { font(c, 26 * S.k, MONO); text(c, `#${CLAIM.id}`, x + pad, y + 68 * S.k, DIM, 1 - er); }
  if (er > 0) {
    c.save(); c.globalAlpha = er; c.translate((1 - EASE.expo(er)) * -20, 0);
    pill(c, x + pad, y + 60 * S.k, 'Live on ER', { dotCol: CORAL, size: 24 * S.k });
    c.restore();
  }
  font(c, 26 * S.k, PIXEL, 500); c.textAlign = 'right';
  const seats = stakesIn(t);
  text(c, t >= T.CHALLENGE ? `${CLAIM.category} · ${seats} / 12 seats` : CLAIM.category, x + w - pad, y + 68 * S.k, MUTED);
  c.textAlign = 'left';
  // question
  font(c, 68 * S.k, DISPLAY, 400, -0.68 * S.k);
  CLAIM.q.forEach((l, i) => text(c, l, x + pad, y + (158 + i * 72) * S.k, CREAM));
  // odds bar: hatched until the first counter-stake, then a coral track with the cream creator share
  const bx = x + pad, by = y + 272 * S.k, bw = w - pad * 2, bh = 12 * S.k;
  const n = stakesIn(t);
  if (!n) hatch(c, bx, by, bw, bh);
  else {
    const t0 = T.stakeAt(n - 1), prevShare = n > 1 ? shareAt(n - 1) : 1, share = lerp(prevShare, shareAt(n), EASE.expo(prog(t, t0, t0 + 0.7)));
    const win = prog(t, T.PAYOUT, T.PAYOUT + 0.6);
    c.save(); rrect(c, bx, by, bw, bh, 3); c.clip();
    c.fillStyle = rgba(CORAL); c.fillRect(bx, by, bw, bh);
    c.fillStyle = rgba(PANEL2); c.fillRect(bx, by, bw * share, bh);
    c.fillStyle = rgba(CREAM, 1 - win * 0.7); c.fillRect(bx, by, bw * share, bh);
    c.fillStyle = rgba(INK); c.fillRect(bx + bw * share, by, 3, bh);
    c.restore();
    if (t >= T.VERDICT) { // the proposed side glows
      const g = 1 - prog(t, T.VERDICT, T.VERDICT + 0.9);
      c.save(); c.shadowColor = rgba(CORAL, 0.9); c.shadowBlur = 30 * g + 6; rrect(c, bx + bw * shareAt(STAKES.length) + 3, by, bw * (1 - shareAt(STAKES.length)) - 3, bh, 3); c.fillStyle = rgba(CORAL); c.fill(); c.restore();
    }
  }
  // labels under the bar
  const ly = y + 336 * S.k, sz = 32 * S.k;
  const pct = s => `${Math.round(s * 100)}%`;
  const pctEvents = side => [[0, '—'], ...STAKES.map((_, i) => [T.stakeAt(i), pct(side ? 1 - shareAt(i + 1) : shareAt(i + 1))])];
  const wl = rolling(c, pctEvents(0), t, bx, ly, { size: sz, col: CREAM, flash: false });
  font(c, sz, PIXEL, 500); text(c, CLAIM.yes, bx + wl + 14 * S.k, ly, MUTED);
  const wr = rolling(c, pctEvents(1), t, bx + bw, ly, { size: sz, col: CORAL, align: 'right', flash: false });
  font(c, sz, PIXEL, 500); c.textAlign = 'right'; text(c, CLAIM.no, bx + bw - wr - 14 * S.k, ly, MUTED); c.textAlign = 'left';
  // footer: pool · time left · phase
  c.fillStyle = 'rgba(243,234,214,0.12)'; c.fillRect(x + pad, y + 372 * S.k, w - pad * 2, 2);
  const fy = y + 428 * S.k;
  const pw = rolling(c, poolEvents(), t, x + pad, fy, { size: 40 * S.k });
  font(c, 28 * S.k, PIXEL, 500); text(c, 'pool', x + pad + pw + 14 * S.k, fy, DIM);
  const urgent = t >= T.CLOSE - 1.5 && t < T.CLOSE + 0.5;
  rolling(c, clockEvents(), t, x + w * 0.56, fy, { size: 30 * S.k, col: urgent ? CORAL : MUTED, align: 'center', flash: false });
  const [ph, col, glow] = phaseAt(t);
  font(c, 28 * S.k, PIXEL, 500); c.textAlign = 'right'; text(c, ph, x + w - pad, fy, MUTED);
  dot(c, x + w - pad - width(c, ph) - 20 * S.k, fy - 9 * S.k, 6 * S.k, col, glow);
  c.textAlign = 'left';
}

/** A panel under the card: a glass well with an eyebrow and a right-hand note. */
function well(c, x, y, w, h, S, eyebrow, note, noteCol = MUTED) {
  card(c, x, y, w, h, 22, 'rgba(16,10,11,0.95)');
  const pad = 40 * S.k;
  dot(c, x + pad + 5 * S.k, y + 50 * S.k - 8 * S.k, 5 * S.k, RED);
  font(c, 24 * S.k, PIXEL, 500, 1.2 * S.k); c.textAlign = 'left'; text(c, eyebrow.toUpperCase(), x + pad + 22 * S.k, y + 50 * S.k, RED);
  if (note) { font(c, 26 * S.k, MONO); c.textAlign = 'right'; text(c, note, x + w - pad, y + 50 * S.k, noteCol); c.textAlign = 'left'; }
}

// 2 · stakes streaming in on the rollup
function feed(c, t, x, y, w, h, S) {
  const n = stakesIn(t), avg = n ? Math.round(STAKES.slice(0, n).reduce((a, s) => a + s[2], 0) / n) : 0;
  well(c, x, y, w, h, S, t >= T.CHALLENGE ? 'Ephemeral Rollup' : 'Stakes', t >= T.CHALLENGE ? `${n} tx · $0.00 fees · ${avg || '—'} ms` : 'Solana devnet');
  const pad = 40 * S.k, rowH = 74 * S.k, top = y + 84 * S.k;
  const rows = [{ creator: true, addr: CREATOR.addr, amt: CREATOR.stake, t0: T.CREATOR, img: img.creator }, ...STAKES.map((s, i) => ({ addr: s[0], amt: s[1], ms: s[2], t0: T.stakeAt(i), img: img.w[i] }))];
  const shown = rows.filter(r => t >= r.t0);
  c.save(); c.beginPath(); c.rect(x, top - 6, w, h - (top - y) - 8 * S.k); c.clip();
  shown.slice().reverse().forEach((r, j) => {
    // newest on top; the rest slide down one row as it arrives
    const age = t - r.t0, newest = shown.at(-1);
    const slide = 1 - EASE.expo(prog(t, newest.t0, newest.t0 + 0.4));
    const yy = top + (j - slide) * rowH + rowH / 2;
    const k = j === 0 ? clamp(spring(age, 16, 9), 0, 1.2) : 1;
    const a = j === 0 ? clamp(age / 0.12) : clamp((3.8 - (j - slide)) / 0.8);
    if (a <= 0) return;
    c.save(); c.globalAlpha = a; c.translate((1 - Math.min(1, k)) * 24, 0);
    avatar(c, r.img, x + pad + 24 * S.k, yy, 48 * S.k);
    font(c, 28 * S.k, MONO); text(c, r.addr, x + pad + 68 * S.k, yy + 10 * S.k, CREAM);
    const sideX = x + pad + 290 * S.k;
    pill(c, sideX, yy, r.creator ? 'creator · Yes' : 'No', { fg: r.creator ? CREAM : CORAL, bg: r.creator ? CREAM : CORAL, bga: 0.1, size: 22 * S.k });
    font(c, 30 * S.k, MONO, 500); c.textAlign = 'right';
    text(c, `+${r.amt} USDC`, x + w * 0.7, yy + 10 * S.k, CREAM);
    if (!r.creator) {
      font(c, 26 * S.k, MONO); text(c, '0 fee', x + w * 0.83, yy + 10 * S.k, MUTED);
      const ms = Math.round(r.ms * EASE.expo(prog(t, r.t0, r.t0 + 0.2)));
      text(c, `${ms} ms`, x + w - pad, yy + 10 * S.k, CORAL);
    } else { font(c, 26 * S.k, MONO); text(c, 'on Solana', x + w - pad, yy + 10 * S.k, MUTED); }
    c.textAlign = 'left';
    c.restore();
    if (j === 0 && age < 0.6) { c.save(); c.globalAlpha = (1 - age / 0.6) * 0.18; rrect(c, x + 12, yy - rowH / 2 + 4, w - 24, rowH - 8, 16); c.fillStyle = rgba(CORAL); c.fill(); c.restore(); }
  });
  c.restore();
}

// 3 · the oracle reads the evidence and proposes a verdict
function oracle(c, t, x, y, w, h, S) {
  const proposed = t >= T.VERDICT;
  well(c, x, y, w, h, S, 'Oracle', proposed ? 'proposed' : t >= T.EVID ? 'reading evidence…' : 'deadline passed', proposed ? PENDING : MUTED);
  const pad = 40 * S.k, ly0 = y + 114 * S.k, lh = 46 * S.k;
  font(c, 27 * S.k, MONO);
  EVIDENCE.forEach(([k, v], i) => {
    const t0 = T.EVID + i * 0.375, chars = Math.floor((k.length + v.length + 2) * prog(t, t0, t0 + 0.3));
    if (chars <= 0) return;
    const kk = k.slice(0, chars), vv = v.slice(0, Math.max(0, chars - k.length - 2));
    text(c, kk, x + pad, ly0 + i * lh, DIM);
    text(c, vv, x + pad + 150 * S.k, ly0 + i * lh, i === 2 && chars >= k.length + v.length ? CREAM : MUTED);
  });
  // a scan line reading the well
  const sp = prog(t, T.EVID, T.VERDICT);
  if (sp > 0 && sp < 1) {
    const sy = ly0 - 34 * S.k + sp * (lh * 3 + 10 * S.k);
    const g = c.createLinearGradient(0, sy - 30, 0, sy); g.addColorStop(0, 'rgba(255,43,43,0)'); g.addColorStop(1, 'rgba(255,43,43,0.16)');
    c.fillStyle = g; c.fillRect(x + 14, sy - 30, w - 28, 30); c.fillStyle = rgba(RED, 0.5); c.fillRect(x + 14, sy, w - 28, 2);
  }
  // verdict
  const vy = y + 318 * S.k;
  if (proposed) {
    const k = spring(t - T.VERDICT, 14, 8);
    c.save(); c.translate(x + pad, vy); c.scale(lerp(1.35, 1, clamp(k)), lerp(1.35, 1, clamp(k))); c.globalAlpha = clamp((t - T.VERDICT) / 0.06);
    font(c, 112 * S.k, DISPLAY, 400, -1.1 * S.k); text(c, 'No', 0, 0, CORAL); const nw = width(c, 'No'); text(c, '.', nw, 0, RED);
    font(c, 28 * S.k, PIXEL, 500); text(c, 'Challengers win', nw + 40 * S.k, -6 * S.k, MUTED);
    c.restore();
  }
  // confidence and the verify hash
  const cx = x + w * 0.47;
  const cp = prog(t, T.CONF, T.CONF + 0.25);
  if (cp > 0) {
    c.save(); c.globalAlpha = cp;
    font(c, 24 * S.k, PIXEL, 500); text(c, 'CONFIDENCE', cx, vy - 58 * S.k, DIM);
    const cwid = rolling(c, [[0, '0%'], [T.CONF, '91%']], t, cx, vy - 6 * S.k, { size: 52 * S.k, col: CREAM });
    pill(c, cx + cwid + 16 * S.k, vy - 22 * S.k, 'High', { fg: WIN, bg: WIN, bga: 0.12, size: 24 * S.k });
    c.restore();
  }
  const hp = prog(t, T.HASH, T.HASH + 0.3);
  if (hp > 0) {
    const s = `${HASH} ↗`, n = Math.ceil(s.length * hp);
    font(c, 28 * S.k, MONO, 500); c.textAlign = 'right'; c.globalAlpha = 1;
    const full = width(c, s);
    c.textAlign = 'left'; text(c, s.slice(0, n), x + w - pad - full, vy - 6 * S.k, CORAL);
    font(c, 24 * S.k, PIXEL, 500); text(c, 'VERIFY', x + w - pad - full, vy - 58 * S.k, DIM, hp);
  }
  // 24 h dispute window with a bond, time-lapsed
  const dp = prog(t, T.DISPUTE, T.DISPUTE + 0.25);
  if (dp > 0) {
    const dy = y + h - 40 * S.k;
    c.save(); c.globalAlpha = dp;
    font(c, 26 * S.k, PIXEL, 500); text(c, 'Dispute window 24h · bond 25 USDC', x + pad, dy, MUTED);
    const bx = x + w * 0.58, bw = w - pad - (bx - x), fill = EASE.css(prog(t, T.DISPUTE + 0.1, T.COUNCIL - 0.05));
    rrect(c, bx, dy - 14 * S.k, bw, 8 * S.k, 4 * S.k); c.fillStyle = rgba(PANEL2); c.fill();
    rrect(c, bx, dy - 14 * S.k, Math.max(8 * S.k, bw * fill), 8 * S.k, 4 * S.k); c.fillStyle = rgba(PENDING); c.fill();
    c.restore();
  }
}

// 3b · the council: two juries of ten vote on the same evidence
function council(c, t, x, y, w, h, S) {
  const votes = [...JURY.classic, ...JURY.philosopher].map((s, i) => ({ s, i, yes: YES_VOTES.has(s), t0: T.voteAt(i) }));
  const cast = votes.filter(v => t >= v.t0), no = cast.filter(v => !v.yes).length, yes = cast.length - no;
  well(c, x, y, w, h, S, 'Council', '20 personas');
  // tally rolls with each vote
  const tallyNo = [[0, '0'], ...votes.filter(v => !v.yes).map((v, k) => [v.t0, String(k + 1)])];
  const tallyYes = [[0, '0'], ...votes.filter(v => v.yes).map((v, k) => [v.t0, String(k + 1)])];
  const pad = 40 * S.k, d = 64 * S.k, gap = (w - pad * 2 - d * 10) / 9;
  [['Classic jury', JURY.classic, 0], ['Philosopher jury', JURY.philosopher, 1]].forEach(([label, list, r]) => {
    const ly = y + (98 + r * 132) * S.k, ay = ly + 54 * S.k;
    font(c, 24 * S.k, PIXEL, 500); text(c, label, x + pad, ly, MUTED, clamp((t - T.COUNCIL) / 0.2));
    list.forEach((slug, i) => {
      const idx = r * 10 + i, ax = x + pad + d / 2 + i * (d + gap), v = votes[idx];
      const k = clamp(spring(t - T.popAt(idx), 15, 8), 0, 1.3);
      const voted = t >= v.t0, vk = clamp(spring(t - v.t0, 18, 8), 0, 1.3);
      avatar(c, img.jury[slug], ax, ay, d, voted ? (v.yes ? CREAM : CORAL) : null, k);
      if (voted) { // the vote badge
        c.save(); c.translate(ax + d * 0.36, ay + d * 0.34); c.scale(vk, vk);
        dot(c, 0, 0, 15 * S.k, v.yes ? CREAM : CORAL);
        font(c, 18 * S.k, MONO, 700); c.textAlign = 'center'; c.textBaseline = 'middle'; text(c, v.yes ? 'Y' : 'N', 0, 1, INK); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
        c.restore();
      }
    });
  });
  // tally, bottom row
  const ty = y + h - 34 * S.k;
  font(c, 28 * S.k, PIXEL, 500); text(c, 'No', x + pad, ty, MUTED);
  const w1 = rolling(c, tallyNo, t, x + pad + 52 * S.k, ty, { size: 38 * S.k, col: CORAL, flash: false });
  font(c, 28 * S.k, PIXEL, 500); text(c, '·', x + pad + 70 * S.k + w1, ty, DIM);
  const w2 = rolling(c, tallyYes, t, x + pad + 100 * S.k + w1, ty, { size: 38 * S.k, col: CREAM, flash: false });
  font(c, 28 * S.k, PIXEL, 500); text(c, 'Yes', x + pad + 116 * S.k + w1 + w2, ty, MUTED);
  const fp = prog(t, T.FIRM, T.FIRM + 0.3);
  if (fp > 0) {
    c.save(); c.globalAlpha = fp; c.translate((1 - EASE.expo(fp)) * 30, 0);
    font(c, 26 * S.k, MONO); c.textAlign = 'right'; const note = 'verdict confirmed';
    text(c, note, x + w - pad, ty, MUTED); const nw = width(c, note); c.textAlign = 'left';
    pill(c, x + w - pad - nw - 20 * S.k, ty - 10 * S.k, 'Firm', { fg: WIN, bg: WIN, bga: 0.12, size: 26 * S.k, align: 'right' });
    c.restore();
  }
  return { no, yes };
}

// 4 · winners pull their payout
function payouts(c, t, x, y, w, h, S) {
  const done = PAYOUTS.filter((_, i) => t >= T.pullAt(i) + 0.25).length;
  well(c, x, y, w, h, S, 'Payouts', `pays ${MULT.toFixed(2)}×`);
  const pad = 40 * S.k, rowH = 66 * S.k, top = y + 80 * S.k;
  PAYOUTS.forEach((p, i) => {
    const age = t - T.rowAt(i);
    if (age < 0) return;
    const k = clamp(spring(age, 15, 9), 0, 1.15), yy = top + i * rowH + rowH / 2;
    c.save(); c.globalAlpha = clamp(age / 0.12); c.translate(0, (1 - Math.min(1, k)) * 30);
    avatar(c, img.w[p.w], x + pad + 24 * S.k, yy, 48 * S.k);
    font(c, 28 * S.k, MONO); text(c, p.addr, x + pad + 68 * S.k, yy + 10 * S.k, CREAM);
    font(c, 26 * S.k, MONO); text(c, `staked ${p.stake}`, x + pad + 290 * S.k, yy + 10 * S.k, DIM);
    const pulled = t >= T.pullAt(i);
    font(c, 32 * S.k, MONO, 500); c.textAlign = 'right';
    text(c, `+${p.out.toFixed(2)} USDC`, x + w * 0.74, yy + 11 * S.k, pulled ? WIN : CREAM);
    c.textAlign = 'left';
    // the pull button: press, then a check
    const pp = t - T.pullAt(i), press = pp > 0 && pp < 0.12 ? 0.94 : 1;
    c.save(); c.translate(x + w - pad, yy); c.scale(press, press);
    if (!pulled) pill(c, 0, 0, 'Pull', { fg: [22, 9, 9], bg: CORAL, bga: 1, size: 24 * S.k, align: 'right' });
    else {
      const q = clamp(spring(pp, 16, 8), 0, 1.2);
      c.scale(q, q); pill(c, 0, 0, '✓ Pulled', { fg: WIN, bg: WIN, bga: 0.12, size: 24 * S.k, align: 'right' });
    }
    c.restore();
    if (pp > 0 && pp < 0.5) { c.save(); c.globalAlpha = (1 - pp / 0.5) * 0.5; c.strokeStyle = rgba(WIN); c.lineWidth = 3; c.beginPath(); c.arc(x + w - pad - 50 * S.k, yy, 20 + pp * 160, 0, TAU); c.stroke(); c.restore(); }
    c.restore();
  });
  const sp = prog(t, T.pullAt(3) + 0.25, T.pullAt(3) + 0.55);
  if (sp > 0) {
    font(c, 28 * S.k, PIXEL, 500); c.textAlign = 'left';
    text(c, `${POOL} USDC settled on Solana`, x + pad, y + h - 24 * S.k, MUTED, sp);
  }
  return done;
}

// ── left column: the rolling step numeral, the title, one line
function stepLabel(c, t, S) {
  const marks = [T.CARD, T.CHALLENGE, T.RESOLVE, T.PAYOUT];
  let idx = 0; marks.forEach((m, i) => { if (t >= m) idx = i; });
  const t0 = marks[idx], p = idx ? E.inOutCubic(prog(t, t0, t0 + 0.6)) : 1;
  const x = S.lx, nb = S.numBase, ns = S.numSize;
  // numeral: a column of digits rolling up (l-how-digits), with the red glow
  { const gx = x + ns * 0.3, gy = nb - ns * 0.36, g = c.createRadialGradient(gx, gy, 0, gx, gy, ns * 0.75);
    g.addColorStop(0, 'rgba(255,43,43,0.10)'); g.addColorStop(1, 'rgba(255,43,43,0)'); c.fillStyle = g; c.fillRect(gx - ns, gy - ns, ns * 2, ns * 2); }
  c.save(); c.beginPath(); c.rect(x - 20, nb - ns * 0.82, ns * 1.2, ns * 0.94); c.clip();
  font(c, ns, DISPLAY, 400, -0.04 * ns); c.textAlign = 'left';
  const pos = idx - 1 + p;
  for (let d = 0; d < 4; d++) { const off = (d - pos) * ns * 0.94; if (Math.abs(off) < ns) text(c, String(d + 1), x, nb + off, RED); }
  c.restore();
  // title: the old one lifts away, the new one rises out of its mask
  const tb = S.titleBase, ts = S.titleSize;
  const tx = S.tx ?? x; // square: the title sits beside the numeral
  const drawTitle = (s, yy, a) => { font(c, ts, DISPLAY, 400, -0.01 * ts); text(c, s, tx, yy, CREAM, a); text(c, '.', tx + width(c, s), yy, RED, a); };
  c.save(); c.beginPath(); c.rect(tx - 20, tb - ts * 1.0, S.lw + 40, ts * 1.3); c.clip();
  if (idx && p < 1) drawTitle(COPY.en.steps[idx - 1], tb - p * ts * 1.1, 1 - p);
  const ip = idx ? EASE.expo(prog(t, t0 + 0.12, t0 + 0.8)) : 1;
  drawTitle(COPY.en.steps[idx], tb + (1 - ip) * ts * 1.1, 1);
  c.restore();
  // one line under it (the council line swaps in during Resolve)
  const sub = idx === 2 && t >= T.COUNCIL ? COPY.en.council : COPY.en.subs[idx];
  const subT = idx === 2 && t >= T.COUNCIL ? T.COUNCIL : t0;
  const sp = prog(t, subT + 0.25, subT + 0.85);
  font(c, S.subSize, PIXEL, 500);
  dither(c, sp, g => { font(g, S.subSize, PIXEL, 500); g.textAlign = 'left'; text(g, sub, S.sx ?? x, S.subBase, MUTED); }, { cell: 4, rise: 16, second: true });
}

function layoutFor(W, H) {
  if (W / H > 1.3) {
    return { k: 1, lx: 150, lw: 560, numBase: 510, numSize: 330, titleBase: 656, titleSize: 118, subBase: 728, subSize: 34,
      cx: 790, cy: 84, cw: 990, cardH: 470, py: 584, ph: 420 };
  }
  // square: step label on top, card and panel stacked, all scaled
  const k = 0.86;
  return { k, lx: 70, tx: 170, sx: 70, lw: 860, numBase: 150, numSize: 124, titleBase: 146, titleSize: 96, subBase: 208, subSize: 30,
    cx: 70, cy: 250, cw: 940, cardH: 470 * k, py: 250 + 470 * k + 22, ph: 420 * k, square: true };
}

export default {
  async setup(api) {
    times(api.at.bind(api));
    const { W, H } = api;
    buf = document.createElement('canvas'); buf.width = W; buf.height = H; bctx = buf.getContext('2d', { willReadFrequently: api.render });
    buf2 = document.createElement('canvas'); buf2.width = W; buf2.height = H; b2ctx = buf2.getContext('2d', { willReadFrequently: api.render });
    buildField(W, H, W < 1400 ? 14 : 16);
    const base = import.meta.url.replace(/scene\.js.*$/, '');
    img.horn = await loadImg(`${base}horn.svg`);
    img.jury = Object.fromEntries(await Promise.all([...JURY.classic, ...JURY.philosopher].map(async s => [s, await loadImg(`${base}avatars/${s}.svg`)])));
    img.w = await Promise.all(STAKES.map((_, i) => loadImg(`${base}avatars/wallets/w${i}.svg`)));
    img.creator = await loadImg(`${base}avatars/wallets/w8.svg`);
  },

  draw(ctx, t, api) {
    const { W, H } = api, S = layoutFor(W, H);
    // background: ink to ink-deep, the site's 4px dot screen
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, rgba(INK)); bg.addColorStop(1, rgba(INK_DEEP));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const frame = t * 24; // the hero field paints at 24 fps on the site
    const [sx, sy] = shake(t, [[T.CLOSE, 7], [T.VERDICT, 5]]);
    ctx.save(); ctx.translate(sx, sy);

    // ── 0 · the hero: the field, "Don't argue. Settle." dithering in, the scribble drawing under the accent
    const heroField = Math.min(prog(t, 0, 0.9), 1 - prog(t, T.HERO_OUT, T.HERO_OUT + 0.6) * 0.8) * (1 - prog(t, T.CARD, T.CARD + 1));
    const endField = prog(t, T.END + 0.1, T.HORN + 0.8);
    if (heroField > 0) field(ctx, frame, 0.85 * heroField, heroMask);
    if (endField > 0) field(ctx, frame, 0.5 * endField, (u, v) => { const d = Math.hypot((u - 0.5) * (W / H), v - 0.42) / 1.1; return d < 0.2 ? d / 0.2 * 0.4 : clamp(1 - (d - 0.2) / 0.5); });

    const heroP = life(t, 0.15, 1.15, T.HERO_OUT, 0.28);
    if (heroP > 0) {
      const fs = S.square ? 118 : 168, base = H * 0.5 + fs * 0.3;
      dither(ctx, heroP, c => slogan(c, W / 2, base - (t > T.HERO_OUT ? EASE.expo(prog(t, T.HERO_OUT, T.HERO_OUT + 0.4)) * 60 : 0), fs, prog(t, T.SCRIB, T.SCRIB + 0.65)), { cell: 9, rise: 36 });
    }

    // ── 1–4 · the claim card walks the steps
    const cardP = life(t, T.CARD, 0.6, T.END, 0.35);
    if (cardP > 0) {
      dither(ctx, cardP, c => {
        const k = clamp(spring(t - T.CARD, 11, 7), 0, 1.1);
        c.save(); c.translate(0, (1 - k) * 60);
        claimCard(c, t, S.cx, S.cy, S.cw, S);
        c.restore();
        stepLabel(c, t, S);
      }, { cell: 7, rise: 0 });
    }
    // panels under the card, one per step, dithered across
    const panels = [
      [T.CREATOR, T.CLOSE + 0.25, feed],
      [T.RESOLVE, T.COUNCIL - 0.25, oracle],
      [T.COUNCIL, T.PAYOUT - 0.25, council],
      [T.PAYOUT, T.END, payouts],
    ];
    panels.forEach(([a, b, fn]) => {
      const p = life(t, a, 0.45, b, 0.25);
      if (p > 0 && cardP > 0) dither(ctx, Math.min(p, cardP), c => fn(c, t, S.cx, S.py, S.cw, S.ph, S), { cell: 6, rise: 24 });
    });

    // the deadline: a red wash and a ring off the clock
    const hit = 1 - prog(t, T.CLOSE, T.CLOSE + 0.45);
    if (t >= T.CLOSE && hit > 0) {
      ctx.fillStyle = rgba(RED, 0.10 * hit * hit); ctx.fillRect(-20, -20, W + 40, H + 40);
      const rx = S.cx + S.cw * 0.56, ry = S.cy + 428 * S.k - 10;
      ctx.strokeStyle = rgba(CORAL, 0.6 * hit); ctx.lineWidth = 2 + 10 * hit;
      ctx.beginPath(); ctx.arc(rx, ry, 30 + (1 - hit) * 520, 0, TAU); ctx.stroke();
    }

    // ── end card: the horn, the slogan, the URL
    if (t >= T.END) {
      const hp = prog(t, T.HORN, T.HORN + 0.9), hs = S.square ? 430 : 470;
      const hx = W / 2, hy = S.square ? H * 0.38 : H * 0.37;
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
      const fs = S.square ? 92 : 112, base = S.square ? H * 0.8 : H * 0.8;
      const spP = prog(t, T.SLOGAN, T.SLOGAN + 0.9);
      dither(ctx, spP, c => slogan(c, W / 2, base, fs, prog(t, T.SLOGAN + 0.6, T.SLOGAN + 1.25)), { cell: 7, rise: 30 });
      const up = prog(t, T.URL, T.URL + 0.6);
      dither(ctx, up, c => { font(c, S.square ? 32 : 34, MONO, 500); c.textAlign = 'center'; text(c, COPY.en.url, W / 2, base + (S.square ? 84 : 94), MUTED); c.textAlign = 'left'; }, { cell: 4, rise: 16 });
    }
    ctx.restore();
  },

  post(ctx, t, { W, H }) { vignette(ctx, W, H, 0.28); },
};
