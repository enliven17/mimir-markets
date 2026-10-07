"use client";

/**
 * /arena on Arc: every public market from both contracts, live from Convex
 * (convex/arc.ts, kept current by the indexer). Three views (Open, Settling,
 * Settled) and a VS / Pool filter. Cards link to /arena/arc/<kind>/<id>.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import Countdown from "@/components/arena/Countdown";
import { useNowSec } from "@/components/arena/settlement/useSettleAction";
import { FeedCard } from "@/components/ui/Card";
import { ArenaCardSkeleton } from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import { ARC } from "@/lib/arc/config";
import ArcOnboarding from "../ArcOnboarding";
import { BetChip, jolt } from "./BetFx";
import { arcPhase, BTN_PRIMARY, KIND_LABEL, PHASE_DOT, PHASE_LABEL, Split, type ArcMarket, type ArcPhase } from "./shared";

type View = "open" | "settling" | "settled";
type KindFilter = "all" | "vs" | "pool";
const VIEW_OF: Record<ArcPhase, View> = {
  open: "open",
  awaiting: "settling",
  proposed: "settling",
  disputed: "settling",
  resolved: "settled",
  cancelled: "settled",
};
const VIEWS: Array<[View, string]> = [
  ["open", "Open"],
  ["settling", "Settling"],
  ["settled", "Settled"],
];

export default function ArcArena() {
  const markets = useQuery(api.arc.markets, { limit: 500 });
  const now = useNowSec(30_000);
  const [view, setView] = useState<View>("open");
  const [kind, setKind] = useState<KindFilter>("all");

  const byView = useMemo(() => {
    const out: Record<View, ArcMarket[]> = { open: [], settling: [], settled: [] };
    for (const m of markets ?? []) if (kind === "all" || m.kind === kind) out[VIEW_OF[arcPhase(m, now)]].push(m);
    // Open: closing soonest first. The rest: newest first (the query's order).
    out.open.sort((a, b) => a.deadline - b.deadline);
    return out;
  }, [markets, kind, now]);
  const open = byView.open;
  const inPlay = open.reduce((sum, m) => sum + m.volumeUsd, 0);
  const shown = byView[view];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <h1 className="m-0 font-display text-app-h1 text-cream">Arena</h1>
          <p className="m-0 flex items-center gap-2 text-[14px] text-muted">
            <span aria-hidden className="live-dot !h-1.5 !w-1.5" />
            <span className="text-cream">{markets ? open.length : "-"}</span> open
            <span aria-hidden>·</span>
            <span className="text-cream">{markets ? `$${inPlay.toFixed(2)}` : "-"}</span> in play
            <span aria-hidden>·</span>
            <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-coral">Arc {ARC.network}</span>
          </p>
        </div>
        <Link href="/arena/create" className={BTN_PRIMARY}>
          Open a market
        </Link>
      </header>

      <ArcOnboarding />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Markets" className="flex gap-1 rounded-full bg-panel p-1">
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-full px-4 py-1.5 text-[14px] ${view === v ? "bg-panel-raised text-cream" : "text-muted"}`}
            >
              {label}
              <span className="ml-1.5 text-dim">{markets ? byView[v].length : ""}</span>
            </button>
          ))}
        </div>
        <div aria-label="Market type" className="flex gap-1 text-[13px]">
          {(["all", "vs", "pool"] as const).map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1 ${kind === k ? "bg-panel-raised text-cream" : "text-muted"}`}
            >
              {k === "all" ? "All" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {markets === undefined ? (
        <div role="status" aria-label="Loading markets" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ArenaCardSkeleton />
          <ArenaCardSkeleton />
          <ArenaCardSkeleton />
        </div>
      ) : shown.length === 0 ? (
        <p className="m-0 py-12 text-center text-[15px] text-muted">
          {view === "open" ? (
            <>
              No open markets.{" "}
              <Link href="/arena/create" className="text-coral hover:underline">
                Open the first one
              </Link>
              .
            </>
          ) : (
            "Nothing here yet."
          )}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((m, i) => (
            <ArcMarketCard key={m._id} m={m} now={now} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArcMarketCard({ m, now, index }: { m: ArcMarket; now: number; index: number }) {
  const phase = arcPhase(m, now);
  // A live bet: the card jolts and the new money pops up over the pool (BetFx.tsx).
  const cardRef = useRef<HTMLDivElement>(null);
  const prev = useRef(m.volumeUsd);
  const [bump, setBump] = useState<{ id: number; added: number; side: 1 | 2 } | null>(null);
  const prevA = useRef(m.stakeA);
  useEffect(() => {
    const added = m.volumeUsd - prev.current;
    if (added > 0.000001) {
      jolt(cardRef.current, 0.7);
      setBump({ id: Date.now(), added, side: m.stakeA !== prevA.current ? 1 : 2 });
    }
    prev.current = m.volumeUsd;
    prevA.current = m.stakeA;
  }, [m.volumeUsd, m.stakeA]);
  const winner = phase === "resolved" && (m.winner === 1 || m.winner === 2) ? (m.winner === 1 ? m.labelA : m.labelB) : null;
  return (
    <FeedCard ref={cardRef} index={Math.min(index, 8)} className="group relative h-full focus-within:shadow-bubble-hover">
      {bump ? <BetChip key={bump.id} bet={{ id: String(bump.id), side: bump.side, amount: String(BigInt(Math.round(bump.added * 1e6)) * 1_000_000_000_000n) }} tone={bump.side === 1 ? "cream" : "coral"} /> : null}
      <Link
        href={`/arena/arc/${m.kind}/${m.marketId}`}
        className="flex h-full min-h-[212px] flex-col gap-4 rounded-2xl p-5 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-coral sm:p-6"
      >
        <div className="flex min-h-[22px] items-center justify-between gap-3 text-[12px]">
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-panel-raised px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-coral">
              {KIND_LABEL[m.kind]}
            </span>
            <span className="font-mono text-dim">#{m.marketId}</span>
          </span>
          <span className="truncate text-muted">
            {m.category} · {m.participants} in
          </span>
        </div>

        <h3 className="m-0 line-clamp-3 text-card-title text-cream [text-wrap:pretty]">{m.question}</h3>

        <div className="mt-auto grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <Split m={m} />
          <div className="flex justify-between gap-3 text-[12px]">
            <span className="min-w-0 max-w-[48%] truncate text-cream">{m.labelA}</span>
            <span className="min-w-0 max-w-[48%] truncate text-right text-coral">{m.labelB}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5 text-[13px]">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[15px] text-cream">${m.volumeUsd.toFixed(2)}</span>
            <span className="text-dim">pool</span>
          </span>
          <span className="truncate font-mono text-[12px] text-muted">
            {phase === "open" ? <Countdown until={m.deadline} format={(t) => `${t} left`} /> : winner}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-muted">
            <span aria-hidden className={`h-[6px] w-[6px] rounded-full ${PHASE_DOT[phase]}`} />
            {PHASE_LABEL[phase]}
          </span>
        </div>
      </Link>
    </FeedCard>
  );
}

