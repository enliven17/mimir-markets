"use client";

/**
 * Claim hero: back link, status, the question, then either the duel (both
 * sides with their pool share and stake, the pool and the time left) or, once
 * resolved, the settlement receipt. The 4-step lifecycle bar sits under it.
 */
import { SURFACE } from "@/components/arena/surface";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import RollingNumber from "@/components/motion/RollingNumber";
import { buttonClass } from "@/components/ui/Button";
import Progress from "@/components/ui/Progress";
import { Pending, StatusPill } from "@/components/ui/StatusPill";
import HolderBadge from "@/components/token/HolderBadge";
import type { ApiClaim } from "@/lib/server/arena-claim";
import type { TokenTier } from "@/lib/token-tiers";
import { claimPhase, displayedSide, isPendingVerdict, type ClaimPhase } from "@/lib/claim-status";
import Countdown from "@/components/arena/Countdown";
import { SplitBar } from "@/components/arena/OddsBar";
import { confidenceTier } from "@/lib/settlement-preview";
import { impliedOdds, oddsBarWidths } from "@/lib/odds";
import { poolOf } from "@/lib/arena-feed";
import { formatUsdcBare, unitsToUsdc } from "@/lib/money";
import { shortKey } from "@/components/arena/settlement/useSettleAction";

const money = (n: number) => `$${formatUsdcBare(n)}`;
const pct = (n: number) => `${Math.round(n)}%`;

/** Created → Accepted → Verifying → Settled; null hides the bar (cancelled). */
function lifecycleStep(phase: ClaimPhase): number | null {
  switch (phase) {
    case "open":
      return 0;
    case "active":
      return 1;
    case "awaiting":
    case "proposed":
    case "disputed":
      return 2;
    case "resolved":
      return 3;
    default:
      return null;
  }
}

function PhasePill({ phase, label }: { phase: ClaimPhase; label: string }) {
  if (phase === "open" || phase === "active") return <Pending>{label}</Pending>;
  if (phase === "proposed" || phase === "awaiting") return <Pending live={false}>{label}</Pending>;
  return <StatusPill tone={phase === "resolved" ? "win" : phase === "disputed" ? "danger" : "neutral"}>{label}</StatusPill>;
}

export default function Hero({
  claim,
  now,
  tiers,
  className = "",
}: {
  claim: ApiClaim;
  now: number;
  tiers: Record<string, TokenTier | undefined>;
  className?: string;
}) {
  const t = useTranslations("arena");
  const phase = claimPhase(claim.state, claim.deadline, now);
  const step = lifecycleStep(phase);
  const isFlash = claim.resolutionUrl.includes("flashapi.trade");
  const live = phase === "open" || phase === "active";

  return (
    <section aria-labelledby="claim-question" className={`grid min-w-0 gap-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/arena"
          className="press mr-1 inline-flex min-h-[34px] items-center gap-1.5 rounded-full pr-2 text-[14px] text-muted transition-colors hover:text-cream"
        >
          <span aria-hidden>←</span>
          {t("detail.back")}
        </Link>
        <PhasePill phase={phase} label={t(`phase.${phase}`)} />
        {claim.delegated && live ? <StatusPill tone="live">{t("detail.er")}</StatusPill> : null}
        {isFlash ? <StatusPill dot={false}>{t("detail.flash")}</StatusPill> : null}
        <span className="ml-auto font-mono text-[12px] text-dim">#{claim.id}</span>
      </div>

      <h1 id="claim-question" className="m-0 font-display text-[clamp(1.85rem,6.4vw,2.9rem)] leading-[1] tracking-[-0.02em] text-cream [text-wrap:balance]">
        {claim.question}
      </h1>

      {phase === "resolved" ? <Receipt claim={claim} /> : <Duel claim={claim} phase={phase} tiers={tiers} />}

      {step !== null ? (
        <Progress steps={t.raw("detail.progress") as string[]} current={step} label={t("detail.progressLabel")} />
      ) : null}
    </section>
  );
}

function Duel({
  claim,
  phase,
  tiers,
}: {
  claim: ApiClaim;
  phase: ClaimPhase;
  tiers: Record<string, TokenTier | undefined>;
}) {
  const t = useTranslations("arena.detail");
  const odds = impliedOdds(claim);
  const widths = oddsBarWidths(odds);
  const count = claim.challengers.length;
  const leaning = displayedSide(claim.state, claim.winnerSide, claim.proposedSide);

  const side = (
    who: "creator" | "challengers",
    position: string,
    stakeUnits: string,
    probability: number | null,
    identity: React.ReactNode,
  ) => {
    const isCreator = who === "creator";
    const proposed = isPendingVerdict(claim.state) && leaning === (isCreator ? 1 : 2);
    return (
      <div
        className={`grid min-w-0 content-start gap-2 rounded-xl p-3.5 sm:p-4 ${
          proposed ? "bg-coral/[0.1] shadow-[inset_0_0_0_1px_rgb(255_81_72/.35)]" : "bg-cream/[0.035]"
        }`}
      >
        <p className={`m-0 flex min-w-0 items-center gap-2 text-[12px] ${isCreator ? "text-muted" : "text-coral"}`}>
          <span aria-hidden className={`h-[7px] w-[7px] flex-none rounded-[2px] ${isCreator ? "bg-cream" : "bg-coral"}`} />
          {isCreator ? t("creator") : t("challengers")}
        </p>
        <p className="m-0 line-clamp-2 min-h-[2.6em] text-[14px] leading-[1.3] text-cream" title={position}>
          {position}
        </p>
        <p className="m-0 flex items-baseline justify-between gap-2">
          {probability === null ? (
            <span className="font-display text-[2rem] leading-none text-dim">—</span>
          ) : (
            <RollingNumber value={probability * 100} format={pct} className="font-display text-[2rem] leading-none text-cream" mono={false} />
          )}
          <RollingNumber value={unitsToUsdc(stakeUnits)} format={money} className="text-[13px] text-muted" />
        </p>
        <div className="flex min-h-[20px] min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-muted">{identity}</div>
      </div>
    );
  };

  const first = claim.challengers[0];
  const challengerIdentity =
    count === 0 ? (
      <span className="italic">{t("waiting")}</span>
    ) : count === 1 && first ? (
      <>
        <span className="font-mono">{shortKey(first.addr)}</span>
        <HolderBadge tier={tiers[first.addr]} />
      </>
    ) : (
      <span>{t("challengersJoined", { count })}</span>
    );

  const closes = phase === "open" || phase === "active";

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        {side(
          "creator",
          claim.creatorPosition,
          claim.creatorStake,
          odds.creatorProbability,
          <>
            <span className="font-mono">{shortKey(claim.creator)}</span>
            <HolderBadge tier={tiers[claim.creator]} />
          </>,
        )}
        {side("challengers", claim.counterPosition, claim.totalChallengerStake, odds.challengerProbability, challengerIdentity)}
      </div>
      <SplitBar creator={widths.creator} unpriced={odds.unpriced} className="h-[6px]" />
      <dl className="m-0 flex items-baseline justify-between gap-4 text-[13px]">
        <div className="flex items-baseline gap-2">
          <dt className="text-muted">{t("pool")}</dt>
          <dd className="m-0">
            <RollingNumber value={poolOf(claim)} format={money} flash className="text-[18px] text-cream" />
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-muted">{closes ? t("closesIn") : t("closedAt")}</dt>
          <dd className="m-0 font-mono text-[15px] tabular-nums text-cream">
            {closes ? <Countdown until={claim.deadline} /> : new Date(claim.deadline * 1000).toLocaleDateString()}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Receipt({ claim }: { claim: ApiClaim }) {
  const t = useTranslations("arena");
  const tier = confidenceTier(claim.winnerSide, claim.confidence, claim.resolutionSummary ?? "");
  const tTier = useTranslations("settlementPreview");
  return (
    <div className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[12px] text-muted">{t("detail.verdict")}</p>
        <StatusPill tone={tier === "refunded" ? "neutral" : "win"} dot>
          {tTier(`tier.${tier}`)}
          {claim.confidence > 0 ? ` · ${t("detail.confidence", { pct: claim.confidence })}` : ""}
        </StatusPill>
      </div>
      <p className="m-0 font-display text-[clamp(1.7rem,5vw,2.4rem)] leading-none text-cream">
        {t(`side.${claim.winnerSide}` as "side.1")}
      </p>
      {claim.resolutionSummary?.trim() ? (
        <p className="m-0 line-clamp-3 text-[14px] leading-relaxed text-muted">{claim.resolutionSummary}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="m-0 flex items-baseline gap-2 text-[13px] text-muted">
          {t("detail.poolSettled")}
          <span className="font-mono text-[18px] text-cream">{money(poolOf(claim))}</span>
        </p>
        <Link href={`/verify/${claim.id}`} className={buttonClass("ghost", "sm")}>
          {t("detail.verify")} →
        </Link>
      </div>
    </div>
  );
}
