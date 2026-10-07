"use client";

/**
 * Live bet effects, the way pump.fun makes a chart feel alive: when a new
 * stake lands (a live Convex update, never the first load), a "+$X" chip
 * flies into the side it backed and that side jolts, so a busy market looks
 * busy. GSAP on transforms and opacity only; nothing under reduced motion.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

import type { Doc } from "@/convex/_generated/dataModel";
import { gsap, reducedMotion } from "@/lib/motion";
import { usd } from "./shared";

type Event = Doc<"arcEvents">;
export interface Bet {
  id: string;
  side: 1 | 2;
  amount: string;
}

const BET_EVENTS = new Set(["Staked", "ClaimChallenged", "ClaimCreated", "MarketCreated"]);

/** VS: the creator backs side 1, challengers side 2; pools say which side. */
function betSide(e: Event): 1 | 2 | null {
  if (e.name === "ClaimChallenged") return 2;
  if (e.name === "ClaimCreated") return 1;
  if (e.name === "Staked") return e.side === 2 ? 2 : 1;
  return null;
}

/** Bets that arrive while the page is open; the first snapshot only sets the baseline. */
export function useNewBets(events: Event[] | undefined): Bet[] {
  const seen = useRef<Set<string> | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  useEffect(() => {
    if (!events) return;
    if (!seen.current) {
      seen.current = new Set(events.map((e) => e._id));
      return;
    }
    const fresh: Bet[] = [];
    for (const e of events) {
      if (seen.current.has(e._id)) continue;
      seen.current.add(e._id);
      const side = betSide(e);
      // MarketCreated has no amount; its Staked twin carries the stake.
      if (BET_EVENTS.has(e.name) && side && e.amount && e.amount !== "0") fresh.push({ id: e._id, side, amount: e.amount });
    }
    if (fresh.length) setBets((b) => [...b, ...fresh].slice(-6));
  }, [events]);
  const done = (id: string) => setBets((b) => b.filter((x) => x.id !== id));
  useEffect(() => {
    if (!bets.length) return;
    const t = setTimeout(() => done(bets[0].id), 1600);
    return () => clearTimeout(t);
  }, [bets]);
  return bets;
}

/** A short jolt on `ref`: a few pixels each way and a hair of rotation, then still. */
export function jolt(el: HTMLElement | null, strength = 1) {
  if (!el || reducedMotion()) return;
  gsap.killTweensOf(el);
  gsap.fromTo(
    el,
    { x: 0, rotation: 0 },
    {
      keyframes: [
        { x: -4 * strength, rotation: -0.6 * strength, duration: 0.05 },
        { x: 4 * strength, rotation: 0.6 * strength, duration: 0.06 },
        { x: -2.5 * strength, rotation: -0.3 * strength, duration: 0.06 },
        { x: 1.5 * strength, rotation: 0.2 * strength, duration: 0.06 },
        { x: 0, rotation: 0, duration: 0.08 },
      ],
      ease: "power1.out",
    },
  );
}

/** Jolt `ref` every time `trigger` changes after the first render. */
export function useJoltOn(ref: RefObject<HTMLElement | null>, trigger: unknown, strength = 1) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    jolt(ref.current, strength);
  }, [ref, trigger, strength]);
}

/** The "+$X" chip: rises into its side from below, holds, fades up and out. */
export function BetChip({ bet, tone }: { bet: Bet; tone: "cream" | "coral" }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      gsap.set(el, { opacity: 1 });
      return;
    }
    const tl = gsap.timeline();
    tl.fromTo(el, { y: 28, opacity: 0, scale: 0.6 }, { y: 0, opacity: 1, scale: 1.08, duration: 0.28, ease: "back.out(2.4)" })
      .to(el, { scale: 1, duration: 0.12 })
      .to(el, { y: -22, opacity: 0, duration: 0.5, ease: "power2.in" }, "+=0.55");
    return () => {
      tl.kill();
    };
  }, []);
  return (
    <span
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute right-3 top-3 rounded-full px-2.5 py-1 font-mono text-[13px] font-medium opacity-0 shadow-[0_6px_18px_rgb(0_0_0/.45)] ${
        tone === "cream" ? "bg-cream text-[#160909]" : "bg-coral text-[#160909]"
      }`}
    >
      +{usd(bet.amount)}
    </span>
  );
}
