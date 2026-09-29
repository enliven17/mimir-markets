"use client";

/**
 * The wallet's positions (creator or challenger), newest first, with its own
 * stake, the claim phase and what it means for the wallet. Paged with
 * "Load more"; empty states instead of mock data.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { claimPhase, PHASE_LABEL } from "@/lib/claim-status";
import {
  claimableLegs,
  positionOutcome,
  positionRole,
  positionStake,
  type PositionClaim,
  type PositionOutcome,
} from "@/lib/dashboard-positions";
import { formatUsdcUnits } from "@/lib/money";

const PAGE = 8;

const OUTCOME_TONE: Record<PositionOutcome, string> = {
  open: "text-pv-emerald",
  pending: "text-pv-emerald",
  won: "text-pv-gold",
  lost: "text-pv-danger",
  refund: "text-pv-muted",
  cancelled: "text-pv-muted",
};

interface Props {
  claims: (PositionClaim & { deadline: number })[];
  viewer: string;
  totalCount: number;
  loading: boolean;
  onResetFilters: () => void;
}

export default function PositionList({ claims, viewer, totalCount, loading, onResetFilters }: Props) {
  const t = useTranslations("dashboard");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [claims.length]);

  if (loading && totalCount === 0) {
    return (
      <ul aria-busy className="divide-y divide-pv-border/15" aria-label={t("loadingPositions")}>
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="h-16 animate-pulse bg-pv-surface/60 motion-reduce:animate-none" />
        ))}
      </ul>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="bp-paper px-5 py-12 text-center">
        <h3 className="text-sm font-semibold text-pv-text">{t("emptyTitle")}</h3>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-pv-muted">{t("emptyDesc")}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/arena" className="btn-ghost !w-auto !min-h-0 !px-4 !py-2 !text-xs">
            {t("browseArena")}
          </Link>
          <Link href="/arena/create" className="btn-primary !w-auto !min-h-0 !px-4 !py-2 !text-xs">
            {t("publishClaim")}
          </Link>
        </div>
      </div>
    );
  }

  if (claims.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <h3 className="text-sm font-semibold text-pv-text">{t("noMatchTitle")}</h3>
        <p className="mt-2 text-xs text-pv-muted">{t("noMatchDesc")}</p>
        <button type="button" onClick={onResetFilters} className="btn-ghost mt-4 !w-auto !min-h-0 !px-4 !py-2 !text-xs">
          {t("resetFilters")}
        </button>
      </div>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  return (
    <>
      <p className="px-4 pt-3 font-mono text-[11px] text-pv-muted sm:px-6">
        {t("showing", { shown: Math.min(shown, claims.length), total: claims.length })}
      </p>
      <ul className="mt-2 divide-y divide-pv-border/15 border-y border-pv-border/15">
        {claims.slice(0, shown).map((c) => {
          const role = positionRole(c, viewer);
          const outcome = positionOutcome(c, viewer);
          const claimable = claimableLegs(c, viewer).reduce((s, l) => s + l.net, 0n);
          return (
            <li key={c.id}>
              <Link href={`/arena/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-pv-surface focus-ring sm:px-6">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="truncate text-sm text-pv-text">
                    <span className="mr-1.5 font-mono text-xs text-pv-muted">#{c.id}</span>
                    {c.question}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-pv-muted">
                    {role ? t(`role.${role}`) : ""} · {c.category || "custom"} · {PHASE_LABEL[claimPhase(c.state, c.deadline, now)]}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm tabular-nums text-pv-text">{formatUsdcUnits(positionStake(c, viewer))}</p>
                  <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${OUTCOME_TONE[outcome]}`}>
                    {claimable > 0n ? t("claimableShort", { amount: formatUsdcUnits(claimable) }) : t(`outcome.${outcome}`)}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {shown < claims.length ? (
        <div className="px-4 py-3 text-center sm:px-6">
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="btn-ghost !w-auto !min-h-0 !px-4 !py-2 !text-xs">
            {t("loadMore")}
          </button>
        </div>
      ) : null}
    </>
  );
}
