"use client";

/**
 * What the council thought about this market: the take (one persona's forecast)
 * first, then each persona that staked (with its tx) or sat out, in its own
 * words. Live from Convex (convex/arcCouncilDb.ts takeFor, forMarket).
 *
 * A one-row carousel: fixed-width cards with clamped text that scroll sideways
 * (scroll snap) and advance on their own every few seconds. It holds still
 * while the pointer or focus is on it, after a swipe, and under
 * prefers-reduced-motion. The track is `relative`, so a card's offsetLeft is
 * its position inside the track.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";

import { getPersonaBySlug } from "@/agents/council/personas";
import { api } from "@/convex/_generated/api";
import { arcExplorerUrl } from "@/lib/arc/config";
import type { ArcMarketKind } from "@/lib/arc/markets";
import { SURFACE } from "@/components/arena/surface";
import { usd } from "./shared";

const ADVANCE_MS = 5000;
const CARD = "flex w-[min(280px,78vw)] flex-none snap-start flex-col gap-1.5 rounded-xl p-3.5";

function Who({ slug }: { slug: string }) {
  const p = getPersonaBySlug(slug);
  return (
    <span className="truncate text-cream">
      <span aria-hidden className="mr-1.5">
        {p?.emoji ?? "•"}
      </span>
      {p?.displayName ?? slug}
    </span>
  );
}

function Carousel({ children, count }: { children: ReactNode; count: number }) {
  const track = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el || count < 2 || held || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      const cards = [...el.children] as HTMLElement[];
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      const next = atEnd ? cards[0] : cards.find((c) => c.offsetLeft > el.scrollLeft + 4);
      if (next) el.scrollTo({ left: next.offsetLeft, behavior: "smooth" });
    }, ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [count, held]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const cards = [...el.children] as HTMLElement[];
    const i = cards.findIndex((c) => c.offsetLeft >= el.scrollLeft - 4);
    setIndex(Math.max(0, i));
  };

  return (
    <div
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      onTouchStart={() => setHeld(true)}
      className="grid gap-2"
    >
      <div
        ref={track}
        onScroll={onScroll}
        className="relative -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      {count > 1 ? (
        <div aria-hidden className="flex justify-center gap-1.5">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={`h-1 rounded-full transition-all duration-300 ${i === index ? "w-4 bg-coral" : "w-1 bg-cream/20"}`} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ArcCouncilTakes({ kind, marketId, labelA, labelB }: { kind: ArcMarketKind; marketId: number; labelA: string; labelB: string }) {
  const takes = useQuery(api.arcCouncilDb.forMarket, { kind, marketId });
  const take = useQuery(api.arcCouncilDb.takeFor, { kind, marketId });
  if (!take && (!takes || takes.length === 0)) return null;
  const sorted = [...(takes ?? [])].sort((a, b) => Number(b.outcome === "staked") - Number(a.outcome === "staked") || b.at - a.at);
  const count = (take ? 1 : 0) + sorted.length;

  return (
    <section aria-label="The council" className={`${SURFACE} grid gap-3 p-5`}>
      <h2 className="m-0 flex items-baseline justify-between gap-2 text-[15px] text-cream">
        The council&apos;s take
        <span className="text-[11px] font-normal text-dim">An AI read, not advice</span>
      </h2>
      <Carousel count={count}>
        {take ? (
          <article className={`${CARD} bg-panel-raised shadow-[inset_0_0_0_1px_rgb(255_81_72/.25)]`}>
            <span className="flex items-baseline justify-between gap-2 text-[13px]">
              <Who slug={take.slug} />
              <span className={`flex-none ${take.lean === 1 ? "text-cream" : take.lean === 2 ? "text-coral" : "text-dim"}`}>
                {take.confidence}%
              </span>
            </span>
            <span className={`text-[12px] ${take.lean === 2 ? "text-coral" : "text-muted"}`}>
              {take.lean === 1 ? `Leans ${labelA}` : take.lean === 2 ? `Leans ${labelB}` : "No clear side"}
            </span>
            <p title={take.text} className="m-0 line-clamp-4 text-[13px] leading-relaxed text-cream">
              {take.text}
            </p>
          </article>
        ) : null}
        {sorted.map((t) => (
          <article key={t.slug} className={`${CARD} bg-panel`}>
            <span className="flex items-baseline justify-between gap-2 text-[13px]">
              <Who slug={t.slug} />
              {t.outcome === "staked" && t.txHash ? (
                <a href={arcExplorerUrl("tx", t.txHash)} target="_blank" rel="noreferrer" className="flex-none font-mono text-[12px] text-coral hover:underline">
                  tx ↗
                </a>
              ) : null}
            </span>
            <span className={`text-[12px] ${t.outcome === "staked" ? "text-coral" : "text-dim"}`}>
              {t.outcome === "staked"
                ? `Challenged${t.amount ? ` with ${usd(t.amount)}` : ""}`
                : `Sat out${t.confidence !== undefined ? ` · ${t.confidence}%` : ""}`}
            </span>
            <p title={t.rationale} className="m-0 line-clamp-4 text-[13px] leading-relaxed text-muted">
              {t.rationale}
            </p>
          </article>
        ))}
      </Carousel>
    </section>
  );
}
