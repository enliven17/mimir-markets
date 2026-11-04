"use client";

/**
 * A linked market's legs (lib/chains/linked.ts): the same question on Base and on Arc, each its own pool with its own
 * money, settled with one verdict. The market page shows every leg's figures side by side (never merged: the pools
 * settle separately) and lets the user pick the chain to stake on; the stake box then works on that leg.
 */
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Link } from "@/i18n/navigation";
import type { ArcMarketKind } from "@/lib/arc/markets";
import { marketPath } from "@/lib/chains/links";
import { marketChain, type MarketChainId } from "@/lib/chains/registry";
import { ChainBadge } from "../NetworkLogos";
import ArcMarketActions from "./ArcMarketActions";
import ArcStakePanel from "./ArcStakePanel";
import { arcPhase, PHASE_LABEL, shareA, type ArcMarket } from "./shared";
import { useArcAccount } from "./useArcAccount";

export interface Leg {
  chain: MarketChainId;
  kind: ArcMarketKind;
  marketId: number;
  status: ArcMarket["status"];
  stakeA: string;
  stakeB: string;
  volumeUsd?: number;
  participants?: number;
  deadline?: number;
  lockAt?: number;
}

const odds = (l: Pick<Leg, "stakeA" | "stakeB">) => {
  const a = shareA(l);
  return a === null ? "no price yet" : `${a.toFixed(0)}% / ${(100 - a).toFixed(0)}%`;
};

/** Every leg's pool and odds side by side, each with its own "Stake on …" button. */
export function LegsCompare({ legs, current, picked, onPick, labelA, labelB, now }: { legs: Leg[]; now: number; current: MarketChainId; picked: MarketChainId; onPick: (c: MarketChainId) => void; labelA: string; labelB: string }) {
  return (
    <section aria-label="Networks" className="grid gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {legs.map((l) => (
          <div key={l.chain} className={`grid gap-1.5 rounded-xl p-3.5 ${picked === l.chain ? "bg-panel-raised shadow-[inset_0_0_0_1px_rgb(255_81_72/.45)]" : "bg-panel"}`}>
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <ChainBadge chain={l.chain} />
              <span className="text-muted">{PHASE_LABEL[arcPhase({ status: l.status, deadline: l.deadline ?? 0, lockAt: l.lockAt }, now)]}</span>
            </div>
            <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13px] text-muted">
              <span className="text-[15px] text-cream">${(l.volumeUsd ?? 0).toFixed(2)}</span> pool
              {l.participants !== undefined ? <span>· {l.participants} in</span> : null}
            </p>
            <p className="m-0 truncate text-[12px] text-dim" title={`${labelA} / ${labelB}`}>
              {odds(l)}
            </p>
            <div className="flex items-center justify-between gap-2">
              <button type="button" aria-pressed={picked === l.chain} onClick={() => onPick(l.chain)} className="text-[13px] text-coral hover:underline">
                Stake on {marketChain(l.chain).label}
              </button>
              {l.chain !== current ? (
                <Link href={marketPath(l.chain, l.kind, l.marketId)} className="text-[12px] text-muted hover:text-cream">
                  Open →
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <p className="m-0 text-[12px] text-dim">Same question on each network, separate pools; settled with one verdict.</p>
    </section>
  );
}

/** The chain switch at the top of the stake box. */
export function StakeChainSwitch({ legs, picked, onPick }: { legs: Leg[]; picked: MarketChainId; onPick: (c: MarketChainId) => void }) {
  return (
    <div role="radiogroup" aria-label="Stake on" className="grid grid-cols-2 gap-1 rounded-full bg-panel p-1">
      {legs.map((l) => (
        <button
          key={l.chain}
          type="button"
          role="radio"
          aria-checked={picked === l.chain}
          onClick={() => onPick(l.chain)}
          className={`inline-flex min-w-0 items-center justify-center gap-1.5 truncate rounded-full px-3 py-1.5 text-[13px] ${picked === l.chain ? "bg-panel-raised text-cream" : "text-muted"}`}
        >
          Stake on {marketChain(l.chain).label}
        </button>
      ))}
    </div>
  );
}

/** The stake box for another leg than the page's own: that leg's market, the wallet on that leg's chain. */
export function LegStakeBox({ leg, now, inSheet = false }: { leg: Leg; now: number; inSheet?: boolean }) {
  const m = useQuery(api.arc.market, { chain: leg.chain, kind: leg.kind, marketId: leg.marketId });
  const account = useArcAccount(leg.chain);
  if (!m) return <p className="m-0 text-[13px] text-muted">{m === null ? "This leg is not indexed yet." : "Loading…"}</p>;
  const me = account.address ?? null;
  const mine = me ? m.positions.filter((p) => p.user === me) : [];
  const phase = arcPhase(m, now);
  return (
    <div className="grid gap-3">
      {phase === "open" ? (
        <ArcStakePanel m={m} mine={mine} account={account} inSheet={inSheet} />
      ) : (
        <p className="m-0 text-[14px] text-muted">
          {PHASE_LABEL[phase]} on {marketChain(leg.chain).label}.
        </p>
      )}
      <ArcMarketActions m={m} mine={mine} account={account} now={now} />
    </div>
  );
}
