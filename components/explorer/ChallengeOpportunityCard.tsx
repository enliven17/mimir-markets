"use client";

/**
 * A source-backed claim draft in the "Suggested claims" rail: the claim text,
 * its category and confidence, deadline and source, the settlement basis
 * behind a disclosure, and one primary action (open the live claim it
 * repeats, or prefill the create flow).
 */
import { PILL, SURFACE } from "@/components/arena/surface";
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import Disclosure from "@/components/ui/Disclosure";
import type { ChallengeOpportunity } from "@/lib/claimDrafts";
import { createPrefillHref } from "@/lib/create-prefill";

function confidenceKey(score: number): "High" | "Medium" | "Low" {
  return score >= 80 ? "High" : score >= 60 ? "Medium" : "Low";
}

export default function ChallengeOpportunityCard({ opportunity }: { opportunity: ChallengeOpportunity }) {
  const t = useTranslations("explore");
  const tCat = useTranslations("categories");
  const locale = useLocale();
  const { candidate } = opportunity;

  const deadline = useMemo(() => {
    const date = new Date(candidate.deadlineAt);
    if (!Number.isFinite(date.getTime())) return candidate.deadlineAt;
    return date.toLocaleString(locale === "en" ? "en-US" : "es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }, [locale, candidate.deadlineAt]);

  const host = useMemo(() => {
    try {
      return new URL(candidate.primaryResolutionSource).hostname.replace(/^www\./i, "");
    } catch {
      return candidate.primaryResolutionSource;
    }
  }, [candidate.primaryResolutionSource]);

  // A candidate that repeats a live claim links to that claim instead.
  const challengeId = opportunity.action === "challenge" ? opportunity.existingClaimId : undefined;
  const href = challengeId ? `/arena/${challengeId}` : createPrefillHref(candidate);

  return (
    <article className={`${SURFACE} flex h-full flex-col gap-3.5 p-5`}>
      <p className="m-0 flex items-center justify-between gap-3 text-[12px] text-muted">
        <span className="capitalize">{tCat(candidate.category)}</span>
        <span>
          {t("aiOpportunityConfidence").toLowerCase()} · {t(`confidence${confidenceKey(candidate.confidenceScore)}`).toLowerCase()}
        </span>
      </p>
      <h3 className="m-0 line-clamp-3 text-card-title text-cream">{candidate.claimText}</h3>
      <p className="m-0 flex flex-wrap gap-x-2 font-mono text-[12px] text-muted">
        <span>{deadline}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{host}</span>
      </p>
      <Disclosure summary={t("aiOpportunitySettlementBasis").toLowerCase()} className="!px-3.5 !py-2.5">
        <p className="m-0 text-[13px] leading-relaxed text-muted">{candidate.settlementRule.replace(/\s+/g, " ").trim()}</p>
      </Disclosure>
      <div className="mt-auto flex items-center gap-2 pt-1">
        <Link href={href} className="btn-compact-primary press min-h-[42px] flex-1 px-4 text-[14px]">
          {challengeId ? t("challengeOpportunityPrimaryChallenge") : t("challengeOpportunityActionCreate")}
        </Link>
        <a
          href={opportunity.sourceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={t("challengeOpportunityOpenSource")}
          title={t("challengeOpportunityOpenSource")}
          className={`${PILL} press grid h-[42px] w-[42px] place-items-center rounded-full text-cream`}
        >
          <ExternalLink size={15} aria-hidden />
        </a>
      </div>
    </article>
  );
}
