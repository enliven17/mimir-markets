"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { RollingNumber, SplitReveal, useRiseBatch } from "@/components/motion";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { Pending } from "@/components/ui/StatusPill";
import { creatorShare, featuredClaim, landingPhase, poolUsdc, timeLeft, type LandingClaim } from "@/lib/landing";
import { formatUsdcBare, unitsToUsdc } from "@/lib/money";
import { useLandingFeed } from "./LandingFeed";
import { PixelArrow } from "./icons";

const usdc = (n: number) => formatUsdcBare(n);

/** Unix seconds, refreshed every 30s so "closes in" stays honest. */
export function useNow(stepMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
}

function Inspector({ claim, now }: { claim: LandingClaim; now: number }) {
  const t = useTranslations("home.claim");
  const phase = landingPhase(claim, now);
  const share = creatorShare(claim);
  const max = claim.maxChallengers && claim.maxChallengers > 0 ? claim.maxChallengers : null;

  return (
    <figure className="l-insp l-mock" aria-labelledby={`claim-${claim.id}-q`}>
      <div className="l-insp-head">
        <span>{t("figure", { id: claim.id, category: claim.category })}</span>
        <Pending live={phase === "open" || phase === "active"}>{t(`phase.${phase}`)}</Pending>
      </div>
      <h3 id={`claim-${claim.id}-q`} className="l-insp-q">
        {claim.question}
      </h3>
      <div className="l-sides">
        <div className="l-side">
          <span title={claim.creatorPosition}>
            {t("creator")} · {claim.creatorPosition}
          </span>
          <span className="font-mono text-[13px] text-cream">{usdc(unitsToUsdc(claim.creatorStake))}</span>
        </div>
        <div className="l-split" aria-hidden>
          <i style={{ flexGrow: share }} />
          <i style={{ flexGrow: 1 - share }} />
        </div>
        <div className="l-side">
          <span title={claim.counterPosition}>
            {t("challengers")} · {claim.counterPosition}
          </span>
          <span className="font-mono text-[13px] text-cream">{usdc(unitsToUsdc(claim.totalChallengerStake))}</span>
        </div>
      </div>
      <dl className="kv">
        <dt>{t("pool")}</dt>
        <dd>
          <RollingNumber value={poolUsdc(claim)} format={usdc} flash /> USDC
        </dd>
        <dt>{t("seats")}</dt>
        <dd>
          {claim.challengers.length}
          {max ? ` / ${max}` : ""}
        </dd>
        <dt>{t("closes")}</dt>
        <dd>{timeLeft(claim.deadline, now)}</dd>
        <dt>{t("market")}</dt>
        <dd>{claim.delegated ? t("marketEr") : t("marketBase")}</dd>
      </dl>
      <div className="l-insp-foot">
        <span className="font-mono text-[12px] text-dim">#{claim.id}</span>
        <Link href={`/arena/${claim.id}`} className="l-link">
          {t("open")}
          <PixelArrow size={14} />
        </Link>
      </div>
    </figure>
  );
}

/**
 * 4. One claim: a real live claim from the feed as an inspector card (both
 * sides, pool split, seats, time left, where the market runs). Loading shows
 * a card-sized skeleton; no live claim shows a one-line empty state.
 */
export default function ClaimInspector() {
  const t = useTranslations("home.claim");
  const { feed, status } = useLandingFeed();
  const root = useRef<HTMLElement>(null);
  const now = useNow();
  const claim = featuredClaim(feed, now);

  useRiseBatch(root);

  return (
    <section ref={root} className="l-section l-wrap" aria-labelledby="claim-title">
      <div className="l-duo">
        <div>
          <p className="eyebrow l-eyebrow" data-rise>
            {t("eyebrow")}
          </p>
          <SplitReveal>
            <h2 id="claim-title" className="l-h2">
              {t("title")} <span className="l-accent">{t("titleAccent")}</span>
            </h2>
          </SplitReveal>
          <p className="l-sub" data-rise>
            {t("sub")}
          </p>
        </div>
        <div data-rise>
          {claim ? (
            <Inspector claim={claim} now={now} />
          ) : status === "loading" ? (
            <div className="l-mock l-insp-skel" role="status" aria-label={t("loading")}>
              <Skeleton className="w-1/2" />
              <Skeleton lines={2} />
              <Skeleton className="!h-1.5" />
              <Skeleton lines={4} className="mt-4" />
            </div>
          ) : (
            <EmptyState
              className="!max-w-none"
              action={
                status === "ready" ? (
                  <Link href="/arena/create" className="l-link !text-coral">
                    {t("emptyCta")}
                    <PixelArrow size={14} />
                  </Link>
                ) : undefined
              }
            >
              {status === "error" ? t("offline") : t("empty")}
            </EmptyState>
          )}
        </div>
      </div>
    </section>
  );
}
