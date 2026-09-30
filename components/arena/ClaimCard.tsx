"use client";

/**
 * Feed card: the question, a thin odds bar with both sides, and one footer
 * row (pool, time left or verdict, status). Category and seats appear on
 * hover or focus; everything else lives on the claim page. The whole card is
 * the link.
 */
import { memo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { RollingNumber } from "@/components/motion";
import { FeedCard } from "@/components/ui";
import OddsBar from "@/components/arena/OddsBar";
import { claimPhase, displayedSide, type ClaimPhase } from "@/lib/claim-status";
import Countdown from "@/components/arena/Countdown";
import { poolOf } from "@/lib/arena-feed";
import { formatUsdcBare } from "@/lib/money";

export interface SolanaClaim {
  id: number;
  creator: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  /** 6-dp base units */
  creatorStake: string;
  /** 6-dp base units */
  totalChallengerStake: string;
  deadline: number;
  state: number;
  winnerSide: number;
  resolutionSummary: string;
  confidence: number;
  createdAt: number;
  maxChallengers: number;
  delegated: boolean;
  challengers: { addr: string; stake: string; paid: boolean }[];
  /** V3: side the oracle proposed while PROPOSED / DISPUTED. */
  proposedSide?: number;
  /** V3: unix seconds; a PROPOSED claim is disputable until then. */
  disputableUntil?: number;
}

const money = (n: number) => `$${formatUsdcBare(n)}`;

const DOT: Record<ClaimPhase, string> = {
  open: "bg-coral shadow-[0_0_7px_rgb(255_81_72/.58)]",
  active: "bg-coral shadow-[0_0_7px_rgb(255_81_72/.58)]",
  awaiting: "bg-pending",
  proposed: "bg-pending",
  disputed: "bg-danger",
  resolved: "bg-win",
  cancelled: "bg-[#615557]",
};

/**
 * Memoized: the feed keeps unchanged claim objects between polls, so only
 * cards whose claim changed re-render. `now` only moves the phase (the page
 * passes a coarse clock); the countdown ticks on its own.
 */
const ClaimCard = memo(function ClaimCard({ claim, now, index = 0 }: { claim: SolanaClaim; now: number; index?: number }) {
  const t = useTranslations("arena");
  const leftFormat = useCallback((time: string) => t("card.left", { time }), [t]);
  const phase = claimPhase(claim.state, claim.deadline, now);
  const live = phase === "open" || phase === "active";
  const side = displayedSide(claim.state, claim.winnerSide, claim.proposedSide);
  const seats = claim.maxChallengers > 0 ? claim.maxChallengers : 1;

  const timeCell = live ? (
    <Countdown until={claim.deadline} format={leftFormat} />
  ) : side
      ? t(`side.${side}` as "side.1")
      : phase === "awaiting"
        ? t("card.closed")
        : null;

  return (
    <FeedCard index={Math.min(index, 8)} className="group h-full focus-within:shadow-bubble-hover">
      <Link
        href={`/arena/${claim.id}`}
        className="flex h-full min-h-[212px] flex-col gap-4 rounded-2xl p-5 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-coral sm:p-6"
      >
        <div className="flex min-h-[22px] items-center justify-between gap-3 text-[12px]">
          {claim.delegated && live ? (
            <span className="inline-flex items-center gap-2 text-pending">
              <span aria-hidden className="live-dot !h-1.5 !w-1.5" />
              {t("card.er")}
            </span>
          ) : (
            <span className="font-mono text-dim">#{claim.id}</span>
          )}
          <span className="truncate text-muted transition-opacity duration-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
            {claim.category}
            {" · "}
            {t("card.seats", { count: claim.challengers.length, max: seats })}
          </span>
        </div>

        <h3 className="m-0 line-clamp-3 text-card-title text-cream [text-wrap:pretty]">{claim.question}</h3>

        <OddsBar
          split={claim}
          creatorPosition={claim.creatorPosition}
          challengerPosition={claim.counterPosition}
          className="mt-auto"
        />

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5 text-[13px]">
          <span className="flex items-baseline gap-1.5">
            <RollingNumber value={poolOf(claim)} format={money} flash className="text-[15px] text-cream" />
            <span className="text-dim">{t("card.pool").toLowerCase()}</span>
          </span>
          {timeCell ? <span className="truncate font-mono text-[12px] text-muted">{timeCell}</span> : null}
          <span className="flex shrink-0 items-center gap-2 text-muted">
            <span aria-hidden className={`h-[6px] w-[6px] rounded-full ${DOT[phase]}`} />
            {t(`phase.${phase}`)}
          </span>
        </div>
      </Link>
    </FeedCard>
  );
});

export default ClaimCard;
