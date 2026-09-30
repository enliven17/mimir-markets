"use client";

/**
 * The basket directory, ranked by followers: one summary line with the
 * compose action, then one card per basket (name, followers, thesis, members).
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { SURFACE } from "@/components/arena/surface";
import { buttonClass } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { PeepStack } from "@/components/ui/PeepAvatar";

interface BasketSummary {
  id: string;
  name: string;
  thesis: string;
  creatorWallet: string;
  house?: boolean;
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
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 min-h-[20px] text-[14px] text-muted">
          {baskets ? t("summary", { baskets: baskets.length, follows }) : null}
        </p>
        <Link href="/baskets/new" className={buttonClass("primary", "sm")}>
          <Plus className="size-4" aria-hidden />
          {t("compose")}
        </Link>
      </div>

      {baskets === null ? (
        <div role="status" className="grid gap-4 md:grid-cols-2" aria-label={t("loading")}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`${SURFACE} grid gap-3 p-6`}>
              <Skeleton className="!h-6 w-1/2" />
              <Skeleton lines={2} />
              <Skeleton className="!h-8 w-1/3 rounded-full" />
            </div>
          ))}
        </div>
      ) : baskets.length === 0 ? (
        <EmptyState
          action={
            <Link href="/baskets/new" className={buttonClass("ghost", "sm")}>
              {t("composeFirst")}
            </Link>
          }
        >
          {t("empty")}
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
          {baskets.map((b) => (
            <li key={b.id} className="min-w-0">
              <Link
                href={`/baskets/${b.id}`}
                className={`${SURFACE} group flex h-full flex-col gap-4 p-6 transition-shadow hover:shadow-[inset_0_0_0_1px_rgb(255_81_72/.32)]`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="m-0 min-w-0 truncate font-display text-[1.45rem] leading-tight text-cream group-hover:text-coral">
                    {b.name}
                  </h2>
                  <span className="flex flex-none items-center gap-2 whitespace-nowrap text-[13px] text-muted">
                    {b.house ? (
                      <span className="rounded-full bg-maroon px-2 py-0.5 text-[12px] text-cream">{t("councilTag")}</span>
                    ) : null}
                    {t("followers", { count: b.followers })}
                  </span>
                </div>
                <p className="m-0 line-clamp-2 text-[14px] leading-relaxed text-muted">{b.thesis}</p>
                <div className="mt-auto flex items-center gap-3">
                  <PeepStack seeds={b.members.map((m) => `council-${m.agentId}`)} max={b.members.length} size={26} />
                  <p className="m-0 min-w-0 truncate font-mono text-[12px] text-muted">
                    {b.members.map((m) => `${m.agentId} ${(m.weightBps / 100).toFixed(0)}%`).join(" · ")}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
