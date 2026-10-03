// Mimir × Telegram (16:9, 20 s, 120 BPM, bar = 2 s, step = 125 ms). A new grammar for the brand clips: no ASCII
// field, no dither, no kinetic word stacks. Flat colour blocks and hard cuts on the beat:
//   1. cream: a 1,000-dot grid fills in while a 48-hour clock runs
//   2. full-bleed red: a giant "1,000", then "users in 48 hours."
//   3. ink: the phone swings in and straightens; numbered step chips (01 to 07) walk the bot:
//      /start → link wallet (one signature) → new-market alert → /bets → "You won" → /price → Open Mimir (Mini App)
//   4. cream end card: the red horn, @mimirmarketsbot, the URL
// Facts: agents/telegram/bot.ts (commands, the launch video on /start, the menu button), lib/telegram.ts (texts),
// app/api/telegram/link (sign once, no transaction), lib/server/telegram.ts (new markets, bet results).
// The user count is the team's figure. Wallets, markets, stakes, payouts and the token price are illustrations.
import { TAU, prog, rgba, E, EASE, spring, setFont, clamp, lerp, shake, vignette, rrect, hash, pointer } from '../../engine/core.js';

// ── tokens (app/globals.css)
const INK = [17, 15, 14], INK_DEEP = [10, 8, 8], PANEL = [28, 20, 21], PANEL2 = [39, 33, 32], CREAM = [243, 234, 214];
const MUTED = [168, 157, 147], DIM = [146, 135, 128], RED = [255, 43, 43], CORAL = [255, 81, 72], WIN = [159, 214, 168];
const PAPER = [236, 226, 204], INKTEXT = [36, 28, 26];
const DISPLAY = "'Terminal Grotesque'", PIXEL = "'Geist Pixel Square'", MONO = "'Geist Mono'";

// ── beat grid (sound.py mirrors these)
const T = {};
function times(at) {
  Object.assign(T, {
    FILL: at(0, 1), FULL: at(1, 6), RED: at(1, 8), USERS: at(2), CUT: at(2, 8), TG: at(2, 10), HANDLE: at(2, 12),
    START: at(3, 4), LINK: at(4, 4), NEW: at(5, 4), BETS: at(6), WON: at(6, 12), PRICE: at(7, 4), APP: at(8),
    END: at(8, 12), HORN: at(8, 14), BOT: at(9, 2), URL: at(9, 6),
  });
}

// ── the step chips: [at, number, title, sub]
const STEPS = () => [
  [T.START, '01', '/start', 'the launch video, then two buttons'],
  [T.LINK, '02', 'Link wallet', 'sign once · no transaction, no funds move'],
  [T.NEW, '03', 'New markets', 'a message the moment one opens'],
  [T.BETS, '04', '/bets', 'your open positions, any time'],
  [T.WON, '05', 'Results', 'won, lost or refunded: you hear first'],
  [T.PRICE, '06', '/price', '$MIMIR price, stats, pump.fun'],
  [T.APP, '07', 'Open Mimir', 'the whole app, inside Telegram'],
];

// ── images
const img = {};
const loadImg = src => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error(`image ${src}`)); i.src = src; });

// ── type
function font(c, px, fam = DISPLAY, w = 400, tr = 0) { setFont(c, w, px, fam, tr); }
function text(c, s, x, y, col, a = 1) { c.fillStyle = rgba(col, a); c.fillText(s, x, y); }
const width = (c, s) => c.measureText(s).width;
const display = (c, fs) => font(c, fs, DISPLAY, 400, -0.01 * fs);
/** Text revealed bottom-up through a line mask (a slab rising), p 0..1. */
function rise(c, s, x, y, fs, col, p, align = 'left') {
  if (p <= 0) return;
  const e = EASE.expo(clamp(p)), w = width(c, s), x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  c.save(); c.beginPath(); c.rect(x0 - 20, y - fs * 1.05, w + 40, fs * 1.3); c.clip();
  c.textAlign = 'left'; text(c, s, x0, y + (1 - e) * fs * 1.1, col);
  c.restore();
}
/** A pop-in scale around (x, y). */
function pop(c, t0, t, x, y, fn, { f = 15, d = 8 } = {}) {
  if (t < t0) return;
  const k = clamp(spring(t - t0, f, d), 0, 1.25);
  c.save(); c.translate(x, y); c.scale(k, k); fn(c); c.restore();
}

// ── shapes
function dot(c, x, y, r, col, a = 1) { c.fillStyle = rgba(col, a); c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
function chip(c, x, y, label, { fg = CREAM, bg = RED, bga = 1, size = 26, fam = MONO, pad = 0.75 } = {}) {
  font(c, size, fam, 500);
  const w = width(c, label) + size * pad * 2, h = size * 1.75;
  rrect(c, x, y - h / 2, w, h, h / 2); c.fillStyle = rgba(bg, bga); c.fill();
  c.textAlign = 'left'; c.textBaseline = 'middle'; text(c, label, x + size * pad, y + 1, fg); c.textBaseline = 'alphabetic';
  return w;
}

// ── act 1: the 1,000-dot grid on cream
const COLS = 40, ROWS = 25, GAP = 27;
let ORDER; // the order the dots light up in
function fillCount(t) { return Math.round(1000 * E.inOutCubic(prog(t, T.FILL, T.FULL))); }
function actGrid(c, t, W, H) {
  c.fillStyle = rgba(CREAM); c.fillRect(0, 0, W, H);
  const n = fillCount(t), gx = W - 120 - (COLS - 1) * GAP, gy = (H - (ROWS - 1) * GAP) / 2;
  for (let i = 0; i < COLS * ROWS; i++) {
    const on = ORDER[i] < n, x = gx + (i % COLS) * GAP, y = gy + Math.floor(i / COLS) * GAP;
    if (!on) { dot(c, x, y, 3, INKTEXT, 0.14); continue; }
    // the newest ~60 dots are still popping: overshoot, then settle
    const k = 1 + 0.5 * Math.sin(Math.PI * clamp((n - ORDER[i]) / 60)) * (n < 1000 ? 1 : 0);
    dot(c, x, y, 9 * k, ORDER[i] % 17 === 0 ? CORAL : RED);
  }
  // left column: the counter and the clock
  c.textAlign = 'left';
  font(c, 26, PIXEL, 500, 2); text(c, 'USERS', 120, 300, INKTEXT, 0.6);
  font(c, 210, MONO, 600, -6); text(c, n.toLocaleString('en-US'), 110, 480, INKTEXT);
  font(c, 26, PIXEL, 500, 2); text(c, 'HOURS SINCE LAUNCH', 120, 640, INKTEXT, 0.6);
  const h = Math.round(48 * prog(t, T.FILL, T.FULL));
  font(c, 120, MONO, 600, -3); text(c, `${String(h).padStart(2, '0')}h`, 110, 760, h >= 48 ? RED : INKTEXT);
  // the clock bar
  c.fillStyle = rgba(INKTEXT, 0.12); c.fillRect(120, 810, 520, 8);
  c.fillStyle = rgba(RED); c.fillRect(120, 810, 520 * prog(t, T.FILL, T.FULL), 8);
}

// ── act 2: full-bleed red, the giant number
function actRed(c, t, W, H) {
  c.fillStyle = rgba(RED); c.fillRect(0, 0, W, H);
  const k = clamp(spring(t - T.RED, 14, 7), 0, 1.2), s = lerp(1.35, 1, k);
  c.save(); c.translate(W / 2, H * 0.5); c.scale(s, s);
  display(c, 560); c.textAlign = 'center'; text(c, '1,000', 0, 120, CREAM);
  c.restore();
  display(c, 120);
  rise(c, 'users in 48 hours.', W / 2, H * 0.86, 120, INK, prog(t, T.USERS, T.USERS + 0.45), 'center');
}

// ── act 3: the phone and the chat
const PH = { w: 600, h: 1000, r: 64 };
const SCR = { x: -270, y: -440, w: 540, h: 880 }; // the screen, phone-local
const HEAD = 128, INPUT = 96, BUB = 440, GAPY = 14, BFS = 25;
const NUM = { won: '+18.40', px: '0.00002146' };

/** Chat messages: { t0, side, h, draw(c, x, y) } with x/y the bubble's top-left. Built once from T. */
let MSGS;
function buildChat() {
  const bubble = (c, x, y, w, h, side) => {
    rrect(c, x, y, w, h, [22, 22, side === 'user' ? 6 : 22, side === 'user' ? 22 : 6]);
    c.fillStyle = side === 'user' ? rgba(RED) : rgba(PANEL2); c.fill();
  };
  const lines = (c, x, y, arr, size = BFS) => arr.forEach(([s, col, fam], i) => { font(c, size, fam ?? PIXEL, 500); text(c, s, x, y + i * size * 1.4, col ?? CREAM); });
  const buttons = (c, x, y, labels) => {
    const bw = (BUB - 10 * (labels.length - 1)) / labels.length;
    labels.forEach((l, i) => {
      rrect(c, x + i * (bw + 10), y, bw, 56, 14); c.fillStyle = 'rgba(243,234,214,0.08)'; c.fill();
      font(c, 22, PIXEL, 500); c.textAlign = 'center'; text(c, l, x + i * (bw + 10) + bw / 2, y + 36, CREAM); c.textAlign = 'left';
    });
  };
  const user = (t0, s) => ({ t0, side: 'user', h: 66, draw(c, x, y) {
    font(c, 26, MONO, 500); const w = width(c, s) + 44;
    bubble(c, x + BUB - w, y, w, 66, 'user'); text(c, s, x + BUB - w + 22, y + 42, CREAM);
  } });
  const bot = (t0, h, fn) => ({ t0, side: 'bot', h, draw: fn });
  return [
    user(T.START + 0.05, '/start'),
    bot(T.START + 0.45, 250, (c, x, y) => { // the launch video
      rrect(c, x, y, BUB, 250, 22); c.fillStyle = rgba(INK_DEEP); c.fill();
      const g = c.createRadialGradient(x + BUB / 2, y + 115, 0, x + BUB / 2, y + 115, 200);
      g.addColorStop(0, 'rgba(255,43,43,0.35)'); g.addColorStop(1, 'rgba(255,43,43,0)'); c.fillStyle = g; c.fillRect(x, y, BUB, 250);
      c.drawImage(img.horn, x + BUB / 2 - 70, y + 40, 140, 153);
      dot(c, x + BUB / 2, y + 116, 38, INK, 0.75);
      c.fillStyle = rgba(CREAM); c.beginPath(); c.moveTo(x + BUB / 2 - 12, y + 98); c.lineTo(x + BUB / 2 + 20, y + 116); c.lineTo(x + BUB / 2 - 12, y + 134); c.closePath(); c.fill();
      font(c, 20, MONO, 500); text(c, 'mimir-launch.mp4 · 0:20', x + 20, y + 230, MUTED);
    }),
    bot(T.START + 0.85, 228, (c, x, y) => {
      bubble(c, x, y, BUB, 160, 'bot');
      lines(c, x + 22, y + 44, [['Welcome to Mimir.', CREAM], ["I'll message you when a market", MUTED], ['opens and when your bets settle.', MUTED]]);
      buttons(c, x, y + 172, ['Link wallet', 'Open Mimir']);
    }),
    bot(T.LINK + 1.15, 112, (c, x, y) => {
      bubble(c, x, y, BUB, 112, 'bot');
      lines(c, x + 22, y + 44, [['✓ Wallet linked', WIN], ['7xKp…3Fa9', MUTED, MONO]]);
    }),
    bot(T.NEW + 0.1, 262, (c, x, y) => {
      bubble(c, x, y, BUB, 196, 'bot');
      chip(c, x + 22, y + 40, 'NEW MARKET', { size: 18, fam: PIXEL, bg: RED });
      lines(c, x + 22, y + 98, [['Will SOL close above $250', CREAM], ['by Friday 18:00 UTC?', CREAM], ['stake 25 USDC · zero fee', MUTED, MONO]], 24);
      buttons(c, x, y + 206, ['Open market']);
    }),
    user(T.BETS + 0.05, '/bets'),
    bot(T.BETS + 0.4, 168, (c, x, y) => {
      bubble(c, x, y, BUB, 168, 'bot');
      lines(c, x + 22, y + 44, [['Your open positions', CREAM]]);
      lines(c, x + 22, y + 92, [['#58 challenger  10 USDC', MUTED, MONO], ['#61 creator     25 USDC', MUTED, MONO]], 23);
    }),
    bot(T.WON + 0.1, 150, (c, x, y) => {
      bubble(c, x, y, BUB, 150, 'bot');
      display(c, 64); text(c, 'You won.', x + 22, y + 66, WIN);
      lines(c, x + 22, y + 112, [[`${NUM.won} USDC · claim #58`, MUTED, MONO]], 21);
    }),
    user(T.PRICE + 0.05, '/price'),
    bot(T.PRICE + 0.4, 214, (c, x, y) => {
      bubble(c, x, y, BUB, 146, 'bot');
      font(c, 30, MONO, 600); text(c, '$MIMIR', x + 22, y + 50, CREAM);
      font(c, 30, MONO, 500); text(c, `$${NUM.px}`, x + 150, y + 50, CREAM);
      lines(c, x + 22, y + 92, [['▲ 12.4% 24h', WIN, MONO], ['mcap $21.4K · vol 24h $41.8K', MUTED, MONO]], 22);
      buttons(c, x, y + 156, ['pump.fun', 'DexScreener']);
    }),
  ];
}

/** Where each visible message sits (bottom-anchored, newest at the bottom), with its arrival progress. */
function chatLayout(t) {
  const shown = MSGS.filter(m => t >= m.t0);
  const bottom = SCR.y + SCR.h - INPUT - 18;
  let y = bottom;
  const out = [];
  for (let i = shown.length - 1; i >= 0; i--) {
    const m = shown[i], a = EASE.expo(prog(t, m.t0, m.t0 + 0.35));
    y -= (m.h + GAPY) * a;
    out.push({ m, y: y + GAPY, a });
  }
  return out;
}

function phoneScreen(c, t) {
  // background and the chat
  c.fillStyle = rgba(INK); c.fillRect(SCR.x, SCR.y, SCR.w, SCR.h);
  const x = SCR.x + 50;
  for (const { m, y, a } of chatLayout(t)) {
    if (y + m.h < SCR.y + HEAD - 40) continue;
    c.save(); c.globalAlpha = clamp(a * 1.4);
    const k = lerp(0.85, 1, clamp(spring(t - m.t0, 16, 9), 0, 1.1));
    const ox = m.side === 'user' ? x + BUB : x;
    c.translate(ox, y + m.h); c.scale(k, k); c.translate(-ox, -(y + m.h));
    m.draw(c, x, y);
    c.restore();
  }
  // header
  c.fillStyle = rgba(PANEL); c.fillRect(SCR.x, SCR.y, SCR.w, HEAD);
  dot(c, SCR.x + 66, SCR.y + 84, 30, INK_DEEP);
  c.drawImage(img.horn, SCR.x + 50, SCR.y + 62, 32, 35);
  c.textAlign = 'left'; font(c, 26, PIXEL, 500); text(c, 'Mimir Markets', SCR.x + 112, SCR.y + 78, CREAM);
  font(c, 19, MONO); text(c, '@mimirmarketsbot · bot', SCR.x + 112, SCR.y + 106, DIM);
  // input bar with the menu button
  const iy = SCR.y + SCR.h - INPUT;
  c.fillStyle = rgba(PANEL); c.fillRect(SCR.x, iy, SCR.w, INPUT);
  const press = life(t, T.APP + 0.15, 0.08, T.APP + 0.35, 0.15);
  rrect(c, SCR.x + 20, iy + 22, 176, 52, 26); c.fillStyle = rgba(press > 0 ? CORAL : RED); c.fill();
  font(c, 21, PIXEL, 500); text(c, 'Open Mimir', SCR.x + 44, iy + 55, CREAM);
  rrect(c, SCR.x + 210, iy + 22, SCR.w - 230, 52, 26); c.fillStyle = 'rgba(243,234,214,0.06)'; c.fill();
  font(c, 21, PIXEL, 500); text(c, 'Message', SCR.x + 236, iy + 55, DIM);
  // overlays
  signSheet(c, t);
  banner(c, t);
  miniApp(c, t);
}
const life = (t, a, din, b = Infinity, dout = 0.3) => Math.min(prog(t, a, a + din), 1 - prog(t, b, b + dout));

/** Link wallet: the site's /telegram page asks for one signature. */
function signSheet(c, t) {
  const p = life(t, T.LINK + 0.3, 0.3, T.LINK + 1.05, 0.25);
  if (p <= 0) return;
  const e = EASE.expo(p), h = 470, y = SCR.y + SCR.h - h * e;
  c.fillStyle = rgba(INK_DEEP, 0.6 * e); c.fillRect(SCR.x, SCR.y, SCR.w, SCR.h);
  rrect(c, SCR.x, y, SCR.w, h + 40, [36, 36, 0, 0]); c.fillStyle = rgba(PANEL2); c.fill();
  c.textAlign = 'left';
  font(c, 20, MONO); text(c, 'mimirmarkets.xyz/telegram', SCR.x + 40, y + 54, DIM);
  display(c, 64); text(c, 'Sign to link', SCR.x + 40, y + 130, CREAM);
  rrect(c, SCR.x + 40, y + 160, SCR.w - 80, 130, 16); c.fillStyle = 'rgba(243,234,214,0.06)'; c.fill();
  font(c, 21, MONO); ['Mimir Telegram link', 'Wallet: 7xKp…3Fa9', 'Code: q8Zt…Lw2c'].forEach((s, i) => text(c, s, SCR.x + 64, y + 202 + i * 32, MUTED));
  const signed = t >= T.LINK + 0.78;
  rrect(c, SCR.x + 40, y + 318, SCR.w - 80, 70, 35); c.fillStyle = rgba(signed ? WIN : RED); c.fill();
  font(c, 24, PIXEL, 500); c.textAlign = 'center'; text(c, signed ? '✓ Signed' : 'Sign message', SCR.x + SCR.w / 2, y + 362, signed ? INK : CREAM);
  font(c, 19, PIXEL, 500); text(c, 'free · no transaction · no funds move', SCR.x + SCR.w / 2, y + 430, DIM); c.textAlign = 'left';
}

/** The new-market push notification dropping in over the chat. */
function banner(c, t) {
  const p = life(t, T.NEW - 0.15, 0.3, T.NEW + 1.0, 0.3);
  if (p <= 0) return;
  const y = SCR.y + lerp(-140, 18, EASE.expo(p));
  c.save(); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 30;
  rrect(c, SCR.x + 16, y, SCR.w - 32, 112, 24); c.fillStyle = 'rgba(52,44,42,0.98)'; c.fill(); c.restore();
  dot(c, SCR.x + 66, y + 56, 26, INK_DEEP); c.drawImage(img.horn, SCR.x + 52, y + 36, 28, 31);
  c.textAlign = 'left'; font(c, 21, PIXEL, 500); text(c, 'Mimir Markets · now', SCR.x + 108, y + 46, DIM);
  font(c, 22, PIXEL, 500); text(c, 'New market: Will SOL close above…', SCR.x + 108, y + 80, CREAM);
}

/** Open Mimir: the site slides up as a Mini App. */
function miniApp(c, t) {
  const p = prog(t, T.APP + 0.35, T.APP + 0.8);
  if (p <= 0) return;
  const y = SCR.y + SCR.h * (1 - EASE.expo(p));
  c.save(); c.beginPath(); c.rect(SCR.x, y, SCR.w, SCR.h); c.clip();
  c.fillStyle = rgba(INK); c.fillRect(SCR.x, y, SCR.w, SCR.h);
  c.fillStyle = rgba(PANEL); c.fillRect(SCR.x, y, SCR.w, 84);
  c.textAlign = 'left'; font(c, 22, PIXEL, 500); text(c, '✕  Mimir', SCR.x + 30, y + 52, CREAM);
  font(c, 18, MONO); c.textAlign = 'right'; text(c, 'mini app', SCR.x + SCR.w - 30, y + 52, DIM); c.textAlign = 'left';
  display(c, 58); text(c, 'Arena', SCR.x + 34, y + 160, CREAM); text(c, '.', SCR.x + 34 + width(c, 'Arena'), y + 160, RED);
  const cards = [['Will SOL close above $250', 'by Friday?', 0.38], ['BTC above $90k', 'at month end?', 0.61], ['Ansem tweets "send it"', 'this week?', 0.27]];
  cards.forEach(([a, b, odds], i) => {
    const cy = y + 196 + i * 200, k = clamp(spring(t - T.APP - 0.6 - i * 0.1, 16, 9), 0, 1.1);
    if (k <= 0) return;
    c.save(); c.globalAlpha = clamp(k); c.translate(0, (1 - k) * 40);
    rrect(c, SCR.x + 30, cy, SCR.w - 60, 176, 18); c.fillStyle = rgba(PANEL2); c.fill();
    chip(c, SCR.x + 52, cy + 38, '● LIVE ON ER', { size: 16, fam: PIXEL, bg: RED, bga: 0.18, fg: CORAL });
    font(c, 23, PIXEL, 500); text(c, a, SCR.x + 52, cy + 92, CREAM); text(c, b, SCR.x + 52, cy + 122, CREAM);
    c.fillStyle = 'rgba(243,234,214,0.1)'; c.fillRect(SCR.x + 52, cy + 146, SCR.w - 104, 8);
    c.fillStyle = rgba(CORAL); c.fillRect(SCR.x + 52, cy + 146, (SCR.w - 104) * odds * EASE.expo(clamp(k)), 8);
    c.restore();
  });
  c.restore();
}

function phone(c, t, W, H) {
  // the swing in: rotated, small, from the right; then it straightens
  const k = clamp(spring(t - T.CUT, 9, 6), 0, 1.15), e = EASE.expo(prog(t, T.CUT, T.CUT + 0.9));
  const push = EASE.expo(prog(t, T.APP + 0.3, T.APP + 0.9)) * (1 - E.inOutCubic(prog(t, T.END - 0.3, T.END)));
  const cx = lerp(W * 1.1, W * 0.66, k), cy = H * 0.5 + 20, rot = lerp(0.42, -0.025, e), s = lerp(0.62, 0.97, e) + 0.06 * push;
  c.save(); c.translate(cx, cy); c.rotate(rot + Math.sin(t * 0.9) * 0.006); c.scale(s, s);
  // the body
  c.save(); c.shadowColor = 'rgba(0,0,0,0.65)'; c.shadowBlur = 90; c.shadowOffsetY = 40;
  rrect(c, -PH.w / 2, -PH.h / 2, PH.w, PH.h, PH.r); c.fillStyle = '#2a2322'; c.fill(); c.restore();
  c.lineWidth = 3; c.strokeStyle = 'rgba(243,234,214,0.16)'; rrect(c, -PH.w / 2, -PH.h / 2, PH.w, PH.h, PH.r); c.stroke();
  c.save(); rrect(c, SCR.x, SCR.y, SCR.w, SCR.h, 44); c.clip(); phoneScreen(c, t); c.restore();
  rrect(c, -60, SCR.y + 14, 120, 30, 15); c.fillStyle = '#0a0808'; c.fill(); // the notch
  // taps: Link wallet, Open Mimir
  const tap = (t0, x, y) => { const a = life(t, t0 - 0.25, 0.15, t0 + 0.35, 0.2); if (a > 0) { c.save(); c.globalAlpha = a; pointer(c, x, y, 1.6, life(t, t0, 0.05, t0 + 0.12, 0.1)); c.restore(); } };
  const welcome = chatLayout(t).find(({ m }) => m === MSGS[2]);
  if (welcome) tap(T.LINK + 0.1, SCR.x + 50 + 110, welcome.y + 172 + 34);
  tap(T.LINK + 0.75, SCR.x + SCR.w / 2 + 40, SCR.y + SCR.h - 470 + 360);
  tap(T.APP + 0.15, SCR.x + 110, SCR.y + SCR.h - INPUT + 50);
  c.restore();
}

/** Bottom-left: the current step, its number rolling in. */
function stepChip(c, t, W, H) {
  const steps = STEPS(), i = steps.findLastIndex(([a]) => t >= a);
  if (i < 0) return;
  const [t0, num, title, sub] = steps[i], age = t - t0;
  const x = 120, y = H - 250;
  // the progress rail: seven ticks
  steps.forEach(([a], k) => { c.fillStyle = k <= i ? rgba(RED) : 'rgba(243,234,214,0.15)'; c.fillRect(x + k * 62, y - 170, 50, 6); });
  c.save(); c.beginPath(); c.rect(x - 10, y - 140, 900, 260); c.clip();
  const e = EASE.expo(prog(age, 0, 0.4)), dy = (1 - e) * 120;
  c.textAlign = 'left';
  font(c, 130, MONO, 600, -4); text(c, num, x, y + dy, RED);
  display(c, 120); text(c, title, x + 230, y + dy, CREAM);
  font(c, 28, PIXEL, 500); text(c, sub, x + 236, y + 62 + dy * 1.4, MUTED, prog(age, 0.15, 0.4));
  c.restore();
}

function actPhone(c, t, W, H) {
  const bg = c.createLinearGradient(0, 0, W, H); bg.addColorStop(0, rgba(INK)); bg.addColorStop(1, rgba(INK_DEEP));
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  // a big red disc behind the phone, breathing on the bar
  const pulse = 1 + 0.02 * Math.sin(t * Math.PI);
  const g = c.createRadialGradient(W * 0.66, H * 0.5, 0, W * 0.66, H * 0.5, 620 * pulse);
  g.addColorStop(0, 'rgba(255,43,43,0.22)'); g.addColorStop(1, 'rgba(255,43,43,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  // headline, top-left, until the steps take over
  const hp = 1 - prog(t, T.START - 0.4, T.START - 0.05); // gone before the first step chip lands
  if (hp > 0) {
    c.save(); c.globalAlpha = hp;
    display(c, 150);
    rise(c, 'Mimir is now', 120, 330, 150, CREAM, prog(t, T.TG, T.TG + 0.4));
    rise(c, 'on Telegram.', 120, 480, 150, RED, prog(t, T.TG + 0.15, T.TG + 0.55));
    pop(c, T.HANDLE, t, 120, 580, g2 => chip(g2, 0, 0, '@mimirmarketsbot', { size: 34, bg: CREAM, fg: INK }));
    c.restore();
  } else {
    // a quiet label above the steps
    font(c, 24, PIXEL, 500, 2); c.textAlign = 'left'; text(c, '@MIMIRMARKETSBOT · HOW IT WORKS', 120, 140, DIM);
  }
  phone(c, t, W, H);
  if (t >= T.START) stepChip(c, t, W, H);
}

// ── act 4: the end card on cream
function actEnd(c, t, W, H) {
  c.fillStyle = rgba(CREAM); c.fillRect(0, 0, W, H);
  const hk = clamp(spring(t - T.HORN, 12, 7), 0, 1.15);
  if (hk > 0) { const hs = 330 * hk, hw = hs * (1148 / 1256); c.drawImage(img.hornRed, W / 2 - hw / 2, H * 0.31 - hs / 2, hw, hs); }
  display(c, 150);
  rise(c, '@mimirmarketsbot', W / 2, H * 0.7, 150, INKTEXT, prog(t, T.BOT, T.BOT + 0.45), 'center');
  font(c, 40, MONO, 500);
  rise(c, 't.me/mimirmarketsbot  ·  mimirmarkets.xyz', W / 2, H * 0.82, 40, RED, prog(t, T.URL, T.URL + 0.4), 'center');
}

// ── cuts: a colour block sweeps across and leaves the next act behind it
const ACTS = [actGrid, actRed, actPhone, actEnd];
const CUTS = () => [[T.RED, RED, 'up'], [T.CUT, INK, 'left'], [T.END, CREAM, 'left']];
const CUT_DUR = 0.32;
function actAt(t) { let i = 0; CUTS().forEach(([a], k) => { if (t >= a) i = k + 1; }); return i; }
function sweep(c, t, W, H) {
  for (const [a, col, dir] of CUTS()) {
    const p = prog(t, a - CUT_DUR, a + CUT_DUR * 0.6);
    if (p <= 0 || p >= 1) continue;
    // in before the cut, out after it: a slab that crosses the frame
    const f = E.inOutCubic(p);
    c.fillStyle = rgba(col);
    if (dir === 'up') { const y1 = H * (1 - f * 2), y0 = y1 + H; c.fillRect(0, Math.max(0, y1), W, Math.min(H, y0) - Math.max(0, y1)); }
    else { const x1 = W * (1 - f * 2), x0 = x1 + W; c.fillRect(Math.max(0, x1), 0, Math.min(W, x0) - Math.max(0, x1), H); }
  }
}

export default {
  async setup(api) {
    times(api.at.bind(api));
    // a fixed, shuffled order for the 1,000 dots
    const idx = Array.from({ length: COLS * ROWS }, (_, i) => i).sort((a, b) => hash(a + 3) - hash(b + 3));
    ORDER = new Array(idx.length); idx.forEach((cell, rank) => { ORDER[cell] = rank; });
    MSGS = buildChat();
    const base = import.meta.url.replace(/scene\.js.*$/, '');
    img.horn = await loadImg(`${base}horn.svg`);
    img.hornRed = await loadImg(`${base}horn-red.svg`);
  },

  draw(ctx, t, api) {
    const { W, H } = api;
    const [sx, sy] = shake(t, [[T.RED, 9], [T.CUT + 0.2, 4], [T.WON + 0.1, 5], [T.HORN, 4]]);
    ctx.save(); ctx.translate(sx, sy);
    ACTS[actAt(t)](ctx, t, W, H);
    sweep(ctx, t, W, H);
    ctx.restore();
  },

  post(ctx, t, { W, H }) { vignette(ctx, W, H, actAt(t) === 2 ? 0.28 : 0.12); },
};
