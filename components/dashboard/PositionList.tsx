"use client";

/**
 * The wallet's positions (creator or challenger), newest first: question,
 * role and phase, its own stake and what the claim means for it. Paged with
 * "Load more"; rows are memoized so a poll only re-renders claims that moved.
 */
import { memo, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { SURFACE } from "@/components/arena/surface";
import { buttonClass } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
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
  open: "text-coral",
  pending: "text-pending",
  won: "text-win",
  lost: "text-danger",
  refund: "text-muted",
  cancelled: "text-muted",
};

type Row = PositionClaim & { deadline: number };

interface Props {
  claims: Row[];
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
      <ul aria-busy aria-label={t("loadingPositions")} className={`${SURFACE} m-0 grid list-none gap-px p-0`}>
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="grid gap-2 px-5 py-4">
            <Skeleton className="w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </li>
        ))}
      </ul>
    );
  }

  if (totalCount === 0) {
    return (
      <EmptyState
        action={
          <span className="flex flex-wrap justify-center gap-2">
            <Link href="/arena" className={`${buttonClass("ghost", "sm")} !min-h-[40px] !text-[14px]`}>
              {t("browseArena")}
            </Link>
            <Link href="/arena/create" className={`${buttonClass("primary", "sm")} !min-h-[40px] !text-[14px]`}>
              {t("publishClaim")}
            </Link>
          </span>
        }
        className="!max-w-[400px]"
      >
        {t("emptyTitle")}
      </EmptyState>
    );
  }

  if (claims.length === 0) {
    return (
      <EmptyState
        action={
          <button type="button" onClick={onResetFilters} className={`${buttonClass("light", "sm")} !min-h-[40px] !text-[14px]`}>
            {t("resetFilters")}
          </button>
        }
      >
        {t("noMatchTitle")}
      </EmptyState>
    );
  }

  // Coarse clock (30s) so memoized rows keep their props between renders.
  const now = Math.floor(Date.now() / 30_000) * 30;
  return (
    <div className="grid gap-3">
      <ul className={`${SURFACE} m-0 list-none divide-y divide-line p-0`}>
        {claims.slice(0, shown).map((c) => (
          <PositionRow key={c.id} claim={c} viewer={viewer} now={now} />
        ))}
      </ul>
      {shown < claims.length ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className={`${buttonClass("ghost", "sm")} mx-auto !min-h-[40px] !text-[14px]`}
        >
          {t("loadMore")}
          <span className="font-mono text-[12px] text-muted">
            {Math.min(shown, claims.length)}/{claims.length}
          </span>
        </button>
      ) : null}
    </div>
  );
}

const PositionRow = memo(function PositionRow({ claim: c, viewer, now }: { claim: Row; viewer: string; now: number }) {
  const t = useTranslations("dashboard");
  const role = positionRole(c, viewer);
  const outcome = positionOutcome(c, viewer);
  const claimable = claimableLegs(c, viewer).reduce((s, l) => s + l.net, 0n);
  return (
    <li>
      <Link
        href={`/arena/${c.id}`}
        className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-cream/[0.035] sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[15px] text-cream">{c.question}</p>
          <p className="m-0 mt-1 truncate text-[12px] text-muted">
            <span className="font-mono text-dim">#{c.id}</span>
            {role ? ` · ${t(`role.${role}`)}` : ""} · {PHASE_LABEL[claimPhase(c.state, c.deadline, now)]}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="m-0 font-mono text-[14px] tabular-nums text-cream">{formatUsdcUnits(positionStake(c, viewer))}</p>
          <p className={`m-0 mt-1 text-[12px] ${claimable > 0n ? "text-coral" : OUTCOME_TONE[outcome]}`}>
            {claimable > 0n ? t("claimableShort", { amount: formatUsdcUnits(claimable) }) : t(`outcome.${outcome}`)}
          </p>
        </div>
      </Link>
    </li>
  );
});
