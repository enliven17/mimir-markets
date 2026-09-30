"use client";

/**
 * Evidence tab: where the verdict comes from (the resolution source and who
 * settles it), the oracle's note once there is one, the market price while
 * the claim is live, and the price cross-check where it runs.
 */
import { useTranslations } from "next-intl";
import MarketPricePanel from "@/components/arena/MarketPricePanel";
import PriceCrossCheckNote from "@/components/arena/PriceCrossCheckNote";
import type { ApiClaim } from "@/lib/server/arena-claim";
import { isLiveState } from "@/lib/claim-status";
import { ST_CANCELLED } from "@/lib/solana/config";
import { sourceOf } from "./source";

export default function EvidenceCard({ claim }: { claim: ApiClaim }) {
  const t = useTranslations("arena.detail.evidence");
  const { href, host, isFlash } = sourceOf(claim.resolutionUrl);
  const hasNote = !isLiveState(claim.state) && claim.state !== ST_CANCELLED;

  return (
    <div className="grid gap-5">
      <dl className="kv">
        <dt>{t("source")}</dt>
        <dd>
          {claim.resolutionUrl ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-cream underline-offset-4 hover:text-coral hover:underline">
              {host} ↗
            </a>
          ) : (
            "-"
          )}
        </dd>
        <dt>{t("settledBy")}</dt>
        <dd className="!font-sans">{isFlash ? t("flash") : t("ai")}</dd>
      </dl>
      {hasNote ? (
        <div className="grid gap-1.5">
          <p className="m-0 text-[12px] text-muted">{t("summary")}</p>
          <p className="m-0 text-[14px] leading-relaxed text-cream">{claim.resolutionSummary?.trim() || t("noSummary")}</p>
        </div>
      ) : null}
      <MarketPricePanel claim={claim} />
      <PriceCrossCheckNote question={claim.question} resolutionUrl={claim.resolutionUrl} />
    </div>
  );
}
