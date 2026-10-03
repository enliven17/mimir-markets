"use client";

/**
 * The Mimir Terminal boot, like an old CRT coming on:
 *   power-on   the screen flickers up out of black at full size
 *   field      the site's ASCII wave floods out from the centre, a scan bar sweeps down
 *   mark       the chevron steps in, the M rises, the cursor lands with an RGB glitch and a jolt
 *   title      MIMIR TERMINAL decodes out of noise, a boot log types out
 *   power-off  the screen collapses back into a line and the terminal is there
 * About 2.8 s. Any key or tap skips it; once per tab session; never with
 * reduced motion. One <pre> and requestAnimationFrame, no canvas.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { SOLANA_CLUSTER } from "@/lib/solana/config";

const CHARS = ".:-=+*#%@";
const NOISE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#%@$&*+=<>/";
const BOOT_KEY = "mimir.terminal.booted";
const TITLE = "MIMIR TERMINAL";

// ms on the boot clock
const ON = 380; // power-on done
const MARK = 420; // chevron starts stepping in
const M_UP = [620, 920] as const; // the M rises
const LAND = 940; // the cursor lands: glitch
const TITLE_AT = 980;
const OFF = 2550; // power-off starts
const END = 2800;

const LOG: [number, string][] = [
  [1180, "mimir terminal · v1 beta"],
  [1380, `solana · ${SOLANA_CLUSTER} · connected`],
  [1560, "council · 20 agents online"],
  [1730, "oracle · listening"],
  [1890, "jupiter · routes ready"],
  [2120, "ready."],
];

/** Should the boot play? Not twice in a tab, not with reduced motion. */
export function shouldBoot(): boolean {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    return sessionStorage.getItem(BOOT_KEY) !== "1";
  } catch {
    return false;
  }
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function waveFrame(cols: number, rows: number, sec: number, reveal: number): string {
  let out = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = x / cols - 0.5, dy = (y / rows - 0.5) * (rows / cols) * 1.8;
      const d = Math.sqrt(dx * dx + dy * dy) * 14;
      if (d / 7 > reveal) {
        out += " ";
        continue;
      }
      const v = Math.sin(d - sec * 7) * 0.5 + 0.5;
      out += CHARS[Math.min(CHARS.length - 1, Math.floor(v * CHARS.length))];
    }
    out += "\n";
  }
  return out;
}

/** The title out of noise: each letter flickers through random glyphs, then settles in order. */
function decoded(t: number): string {
  return [...TITLE]
    .map((ch, i) => {
      if (ch === " ") return " ";
      const settle = TITLE_AT + i * 38;
      if (t < TITLE_AT) return "";
      if (t >= settle + 120) return ch;
      return NOISE[Math.floor(hash(i * 13 + Math.floor(t / 45)) * NOISE.length)];
    })
    .join("");
}

const M_PATH =
  "M0 640V0H160V96H192V160H224V256H256V352H288V480H320V352H352V256H384V160H416V96H448V0H608V640H512V160H480V224H448V352H416V480H384V576H352V640H256V576H224V480H192V352H160V224H128V160H96V640Z";
const CHEV = [0, 48, 96, 144, 96, 48, 0];

function Mark({ t, fill, red }: { t: number; fill: string; red: string }) {
  const steps = Math.min(CHEV.length, Math.max(0, Math.floor((t - MARK) / 34)));
  const rise = easeOut(prog(t, M_UP[0], M_UP[1]));
  return (
    <>
      {CHEV.slice(0, steps).map((x, i) => (
        <rect key={i} x={x} y={96 + i * 64} width={96} height={64} fill={red} />
      ))}
      <g style={{ clipPath: `inset(${(1 - rise) * 100}% 0 0 0)` }}>
        <path fill={fill} transform={`translate(288 ${(1 - rise) * 80})`} d={M_PATH} />
      </g>
      {t >= LAND ? <rect x={960} y={544} width={160} height={96} fill={red} className={t > LAND + 400 ? "animate-blink" : undefined} /> : null}
    </>
  );
}

export default function Boot({ onDone }: { onDone: () => void }) {
  const [t, setT] = useState(0);
  const preRef = useRef<HTMLPreElement>(null);
  const skipAt = useRef<number | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    // Geist Mono at 12px is ~7.2px wide, 16px line: fill the whole screen.
    const cols = Math.ceil(window.innerWidth / 7.2) + 2;
    const rows = Math.ceil(window.innerHeight / 16) + 1;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      try {
        sessionStorage.setItem(BOOT_KEY, "1");
      } catch {
        // fine: it just plays again next time
      }
      onDone();
    };
    const tick = (now: number) => {
      // A skip jumps straight to the power-off.
      let ms = now - t0;
      if (skipAt.current !== null) ms = Math.max(ms, OFF + (now - skipAt.current));
      setT(ms);
      if (preRef.current && ms >= ON * 0.6) preRef.current.textContent = waveFrame(cols, rows, ms / 1000, prog(ms, ON * 0.6, 1300) * 1.15);
      if (ms >= END) finish();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const skip = () => {
      if (skipAt.current === null) skipAt.current = performance.now();
    };
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CRT: on is a flicker up out of black at full size; off collapses into a line.
  const on = easeOut(prog(t, 0, ON));
  const off = prog(t, OFF, END - 40);
  const sy = Math.max(0.004, 1 - off * off);
  const sx = off > 0.6 ? 1 - (off - 0.6) * 2.4 : 1;
  const screen: CSSProperties = {
    transform: off > 0 ? `scale(${sx}, ${sy})` : undefined,
    filter: `brightness(${1 + off * 2.4})`,
    opacity: t < ON ? on * (0.7 + hash(Math.floor(t / 30)) * 0.3) : 1,
  };

  // The landing jolt: a short shake and an RGB split.
  const glitch = t >= LAND && t < LAND + 180;
  const jolt = glitch ? (hash(Math.floor(t / 16)) - 0.5) * 14 : 0;
  const split = glitch ? 4 + hash(Math.floor(t / 20) + 7) * 10 : 0;
  const scanY = ((t - ON) / 1100) % 1;

  return (
    <div aria-hidden className="absolute inset-0 z-30 overflow-hidden bg-black">
      <div className="absolute inset-0 origin-center bg-ink-deep" style={screen}>
        <pre ref={preRef} className="pointer-events-none absolute inset-0 m-0 select-none font-mono text-[12px] leading-[16px] text-coral/25" />
        {/* the scan bar */}
        {t > ON ? (
          <div
            className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-coral/10 to-transparent"
            style={{ top: `calc(${scanY * 100}% - 3rem)` }}
          />
        ) : null}
        {/* scanlines over everything */}
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.25)_0px,rgba(0,0,0,0.25)_1px,transparent_1px,transparent_3px)]" />

        <div className="absolute inset-0 grid place-items-center px-6">
          <div className="grid justify-items-center gap-5" style={{ transform: `translate(${jolt}px, ${-jolt / 2}px)` }}>
            <div className="relative">
              {split > 0 ? (
                <>
                  <svg viewBox="0 0 1120 640" className="absolute inset-0 h-24 w-auto opacity-70 mix-blend-screen sm:h-32" style={{ transform: `translateX(${-split}px)` }}>
                    <Mark t={t} fill="#ff2b2b" red="#ff2b2b" />
                  </svg>
                  <svg viewBox="0 0 1120 640" className="absolute inset-0 h-24 w-auto opacity-70 mix-blend-screen sm:h-32" style={{ transform: `translateX(${split}px)` }}>
                    <Mark t={t} fill="#4fe3ff" red="#4fe3ff" />
                  </svg>
                </>
              ) : null}
              <svg viewBox="0 0 1120 640" className="relative h-24 w-auto sm:h-32">
                <Mark t={t} fill="#f3ead6" red="#ff2b2b" />
              </svg>
            </div>
            <div className="h-7 font-pixel text-[20px] tracking-[0.42em] text-cream sm:text-[24px]">{decoded(t)}</div>
            <div className="min-h-[9.6em] w-[min(30rem,86vw)] font-mono text-[13px] leading-[1.6] sm:text-[14px]">
              {LOG.filter(([at]) => t >= at).map(([at, line], i, shown) => {
                const typed = line.slice(0, Math.floor((t - at) / 8));
                const full = typed.length === line.length;
                const last = i === shown.length - 1;
                return (
                  <div key={line} className={`flex justify-between gap-4 ${line === "ready." ? "text-cream" : "text-muted"}`}>
                    <span>
                      <span className="text-red">›</span> {typed}
                      {last && !full ? <span className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[0.15em] bg-red" /> : null}
                    </span>
                    {full && line !== "ready." ? <span className="text-win">✓</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] text-center font-pixel text-[11px] uppercase tracking-[0.2em] text-dim">
        tap or press any key
      </div>
    </div>
  );
}
