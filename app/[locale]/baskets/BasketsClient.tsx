"use client";

/**
 * The basket directory, ranked by followers. The "nothing is pooled" line is
 * repeated here rather than buried in the docs: a page that looks like a fund
 * should say plainly that it is not.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Layers, Plus, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading, BlueprintStat } from "@/components/BlueprintGrid";
import { PeepStack } from "@/components/ui/PeepAvatar";
import { shortenAddress } from "@/lib/constants";

interface BasketSummary {
  id: string;
  name: string;
  thesis: string;
  creatorWallet: string;
  members: Array<{ agentId: string; weightBps: number }>;
  followers: number;
  createdAt: number;
}

export default function BasketsClient() {
  const t = useTranslations("baskets");
  const [baskets, setBaskets] = useState<BasketSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/baskets")
      .then((r) => r.json())
      .then((d: { baskets?: BasketSummary[] }) => {
        if (!cancelled) setBaskets(d.baskets ?? []);
      })
      .catch(() => {
        if (!cancelled) setBaskets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const follows = (baskets ?? []).reduce((a, b) => a + b.followers, 0);

  return (
    <div className="pb-16">
      <BlueprintHeading as="h1" eyebrow={t("eyebrow")} subtitle={t("lead")}>
        {t("title")}
      </BlueprintHeading>

      <div className="bp-cells grid-cols-3 border-b border-pv-border/25">
        <BlueprintStat value={baskets?.length ?? "–"} label={t("statBaskets")} />
        <BlueprintStat value={baskets ? follows : "–"} label={t("statFollowers")} tone="text" />
        <BlueprintStat value={t("custodyNone")} label={t("statCustody")} tone="gold" />
      </div>

      <div className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex justify-center">
          <Link href="/baskets/new" className="btn-primary inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            {t("compose")}
          </Link>
        </div>

        <div className="mt-8">
          {baskets === null ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[180px] animate-pulse border border-pv-border/25 bg-pv-surface2/40" />
              ))}
            </div>
          ) : baskets.length === 0 ? (
            <div className="bp-paper border border-dashed border-pv-border/40 px-5 py-12 text-center">
              <Layers className="mx-auto h-5 w-5 text-pv-muted" />
              <p className="mt-3 text-sm text-pv-text">{t("empty")}</p>
              <p className="mx-auto mt-1 max-w-sm text-[12px] text-pv-muted">{t("emptyHint")}</p>
              <Link
                href="/baskets/new"
                className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-emerald hover:underline"
              >
                {t("composeFirst")} <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          ) : (
            <div className="bp-cells grid-cols-1 border-b border-pv-border/25 md:grid-cols-2">
              {baskets.map((b) => (
                <Link
                  key={b.id}
                  href={`/baskets/${b.id}`}
                  className="group flex flex-col p-5 transition-colors hover:bg-pv-surface"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-lg font-bold tracking-tight text-pv-text group-hover:text-pv-emerald">
                        {b.name}
                      </h2>
                      <p className="truncate font-mono text-[11px] text-pv-muted">{b.id}</p>
                    </div>
                    <span className="chip inline-flex shrink-0 items-center gap-1">
                      <Users className="h-3 w-3" />
                      {t("followers", { count: b.followers })}
                    </span>
                  </div>

                  <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-pv-text/80">{b.thesis}</p>

                  <div className="mt-4 flex items-center gap-3">
                    <PeepStack seeds={b.members.map((m) => `council-${m.agentId}`)} max={b.members.length} size={26} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {b.members.map((m) => (
                      <span
                        key={m.agentId}
                        className="border border-pv-border/25 bg-pv-bg px-2 py-0.5 font-mono text-[10px] text-pv-text/80"
                      >
                        {m.agentId} <span className="text-pv-muted">{(m.weightBps / 100).toFixed(0)}%</span>
                      </span>
                    ))}
                  </div>

                  <p className="mt-4 border-t border-pv-border/25 pt-3 font-mono text-[10px] text-pv-muted">
                    {t("composedBy", { address: shortenAddress(b.creatorWallet) })}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
