"use client";

/**
 * What the council thought about this market: each persona that staked (with
 * its tx) or considered it and sat out, in its own words. Live from Convex
 * (convex/arcCouncilDb.ts forMarket).
 */
import { useQuery } from "convex/react";

import { getPersonaBySlug } from "@/agents/council/personas";
import { api } from "@/convex/_generated/api";
import { arcExplorerUrl } from "@/lib/arc/config";
import type { ArcMarketKind } from "@/lib/arc/markets";
import { SURFACE } from "@/components/arena/surface";
import { usd } from "./shared";

export default function ArcCouncilTakes({ kind, marketId, labelA, labelB }: { kind: ArcMarketKind; marketId: number; labelA: string; labelB: string }) {
  const takes = useQuery(api.arcCouncilDb.forMarket, { kind, marketId });
  const take = useQuery(api.arcCouncilDb.takeFor, { kind, marketId });
  if (!take && (!takes || takes.length === 0)) return null;
  const sorted = [...(takes ?? [])].sort((a, b) => Number(b.outcome === "staked") - Number(a.outcome === "staked") || b.at - a.at);
  const author = take ? getPersonaBySlug(take.slug) : null;
  return (
    <section aria-label="The council" className={`${SURFACE} grid gap-3 p-5`}>
      <h2 className="m-0 text-[15px] text-cream">The council&apos;s take</h2>
      {take ? (
        <div className="grid gap-1.5 rounded-xl bg-panel-raised p-4 shadow-[inset_0_0_0_1px_rgb(255_81_72/.25)]">
          <span className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
            <span className="text-cream">
              <span aria-hidden className="mr-1.5">
                {author?.emoji ?? "•"}
              </span>
              {author?.displayName ?? take.slug}
            </span>
            <span className={take.lean === 1 ? "text-cream" : take.lean === 2 ? "text-coral" : "text-dim"}>
              {take.lean === 1 ? `leans ${labelA}` : take.lean === 2 ? `leans ${labelB}` : "no clear side"} · {take.confidence}%
            </span>
          </span>
          <p className="m-0 text-[14px] leading-relaxed text-cream">{take.text}</p>
          <p className="m-0 text-[11px] text-dim">An AI read of the evidence, not advice.</p>
        </div>
      ) : null}
    <ul className="m-0 grid list-none gap-3 p-0">
      {sorted.map((t) => {
        const p = getPersonaBySlug(t.slug);
        return (
          <li key={t.slug} className="grid gap-1 rounded-xl bg-panel p-3.5">
            <span className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="text-cream">
                <span aria-hidden className="mr-1.5">
                  {p?.emoji ?? "•"}
                </span>
                {p?.displayName ?? t.slug}
              </span>
              {t.outcome === "staked" ? (
                <span className="flex items-baseline gap-2">
                  <span className="text-coral">challenged{t.amount ? ` with ${usd(t.amount)}` : ""}</span>
                  {t.txHash ? (
                    <a href={arcExplorerUrl("tx", t.txHash)} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-coral hover:underline">
                      tx ↗
                    </a>
                  ) : null}
                </span>
              ) : (
                <span className="text-dim">sat out{t.confidence !== undefined ? ` · ${t.confidence}%` : ""}</span>
              )}
            </span>
            <span className="text-[13px] leading-relaxed text-muted">{t.rationale}</span>
          </li>
        );
      })}
    </ul>
    </section>
  );
}
