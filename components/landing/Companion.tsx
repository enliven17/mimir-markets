"use client";

/**
 * The landing page's companion (after snipad's scroll companion, lighter): a Mimir agent that rides along at the
 * bottom of the screen and reacts to the section you are reading, with one short line per section.
 *
 * - Sections are watched with IntersectionObserver (the landing's aria-labelledby ids, then the footer).
 * - It hops and speaks when the section changes, blinks, and its eyes follow the pointer. A tap pokes it.
 * - Phones: smaller, half off the right edge above the tab bar; it slides out while you scroll, back when you stop.
 * - Reduced motion: it stands still, no hops, blinks or eye tracking.
 * - Decorative and aria-hidden: everything it says is also in the page's own text.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { avatarDataUri, avatarFromSeed, BLINK_MS, blinked, faceOf, type ExpressionName, type Face } from "@/lib/avatar";

const SEED = "njord";
type Zone = "hero" | "how" | "claim" | "dial" | "ledger" | "footer";
const ZONES: Array<[Zone, string]> = [
  ["hero", '[aria-labelledby="hero-title"]'],
  ["how", '[aria-labelledby="how-title"]'],
  ["claim", '[aria-labelledby="claim-title"]'],
  ["dial", '[aria-labelledby="dial-title"]'],
  ["ledger", '[aria-labelledby="ledger-title"]'],
  ["footer", "footer"],
];
const SCENE: Record<Zone, { line: string; mood: ExpressionName }> = {
  hero: { line: "Hi. I'm a Mimir agent.", mood: "happy" },
  how: { line: "The oracle reads the source.", mood: "thinking" },
  claim: { line: "Every verdict is public.", mood: "curious" },
  dial: { line: "That's my council.", mood: "won" },
  ledger: { line: "Settled on Arc.", mood: "bought" },
  footer: { line: "Launch one like me.", mood: "aiming" },
};
const POKES = ["Hey! That tickles.", "Boop.", "Still here.", "Launch me?"];
const SIZE = 72;

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(m.matches);
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}

export default function Companion() {
  const reduce = useReducedMotion();
  const spec = useMemo(() => avatarFromSeed(SEED), []);
  const [zone, setZone] = useState<Zone>("hero");
  const [say, setSay] = useState<string | null>(SCENE.hero.line);
  const [hop, setHop] = useState(0);
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [tucked, setTucked] = useState(false);
  const [poke, setPoke] = useState(0);
  const self = useRef<HTMLDivElement>(null);

  // Which section is on screen: the one crossing the middle of the viewport.
  useEffect(() => {
    const els = ZONES.map(([z, sel]) => [z, document.querySelector(sel)] as const).filter((e): e is readonly [Zone, Element] => !!e[1]);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const z = els.find(([, el]) => el === e.target)?.[0];
          if (z) setZone(z);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const [, el] of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  // A new section: a hop and its line for a few seconds.
  useEffect(() => {
    setSay(SCENE[zone].line);
    setHop((h) => h + 1);
    const t = setTimeout(() => setSay(null), 3200);
    return () => clearTimeout(t);
  }, [zone]);

  // Blinks every few seconds.
  useEffect(() => {
    if (reduce) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(() => {
        setBlink(true);
        t = setTimeout(() => {
          setBlink(false);
          next();
        }, BLINK_MS);
      }, 3000 + Math.random() * 3000);
    };
    next();
    return () => clearTimeout(t);
  }, [reduce]);

  // Eyes follow the pointer (one update per frame).
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const on = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = self.current?.getBoundingClientRect();
        if (!r) return;
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const d = Math.max(1, Math.hypot(dx, dy));
        setLook({ x: Math.round((dx / d) * 10) / 10, y: Math.round((dy / d) * 10) / 10 });
      });
    };
    addEventListener("pointermove", on, { passive: true });
    return () => {
      removeEventListener("pointermove", on);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  // Phones: slide out while scrolling, back in when it stops.
  useEffect(() => {
    if (reduce) return;
    let t: ReturnType<typeof setTimeout>;
    const on = () => {
      if (innerWidth >= 640) return;
      setTucked(true);
      clearTimeout(t);
      t = setTimeout(() => setTucked(false), 450);
    };
    addEventListener("scroll", on, { passive: true });
    return () => {
      removeEventListener("scroll", on);
      clearTimeout(t);
    };
  }, [reduce]);

  const base = faceOf(SCENE[zone].mood);
  let face: Face = poke ? faceOf("surprised") : base;
  if (!reduce) face = { ...face, look: poke ? face.look : look };
  if (blink && !reduce) face = blinked(face);
  const src = avatarDataUri(spec, face, { size: SIZE, id: "companion" });

  return (
    <div
      aria-hidden
      className={`l-companion pointer-events-none fixed z-40 flex items-end gap-2 transition-transform duration-300 ease-out motion-reduce:transition-none ${tucked ? "translate-x-[85%]" : "max-sm:translate-x-[38%]"}`}
      style={{ right: "max(12px, env(safe-area-inset-right))", bottom: "calc(var(--companion-bottom, 20px) + env(safe-area-inset-bottom))" }}
    >
      {say ? (
        <p key={say} className="l-companion-say m-0 mb-10 max-w-[200px] rounded-2xl rounded-br-sm bg-cream px-3 py-2 text-[13px] leading-snug text-ink shadow-[0_10px_30px_rgb(0_0_0/.4)]">
          {say}
        </p>
      ) : null}
      <div
        ref={self}
        key={reduce ? "still" : hop}
        className={`pointer-events-auto cursor-pointer select-none ${reduce ? "" : "l-companion-hop"}`}
        onClick={() => {
          setPoke((p) => p + 1);
          setSay(POKES[poke % POKES.length]);
          setTimeout(() => setPoke(0), 700);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI */}
        <img src={src} width={SIZE} height={SIZE} alt="" draggable={false} className="block drop-shadow-[0_8px_18px_rgb(0_0_0/.45)] [image-rendering:pixelated] max-sm:h-14 max-sm:w-14" />
      </div>
    </div>
  );
}
