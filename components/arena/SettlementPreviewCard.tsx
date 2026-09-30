"use client";

/**
 * Before settlement: how this claim will be decided (mirrors the oracle's
 * decision order). After a verdict: how firm it was, and a link to its audit
 * record on /verify. Unstyled block: it sits in a disclosure on the claim page.
 */
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ApiClaim } from "@/lib/server/arena-claim";
import { confidenceTier, settlementPreview } from "@/lib/settlement-preview";
import { StatusPill } from "@/components/ui";
import { displayedSide, isPendingVerdict } from "@/lib/claim-status";
import { ST_RESOLVED } from "@/lib/solana/config";

export default function SettlementPreviewCard({ claim }: { claim: ApiClaim }) {
  const t = useTranslations("settlementPreview");
  const hasVerdict = claim.state === ST_RESOLVED || isPendingVerdict(claim.state);
  const preview = settlementPreview({
    question: claim.question,
    resolutionUrl: claim.resolutionUrl,
    category: claim.category,
    deadline: claim.deadline,
    disputeWindow: claim.disputeWindow,
  });
  const side = displayedSide(claim.state, claim.winnerSide, claim.proposedSide);
  const tier = hasVerdict ? confidenceTier(side, claim.confidence, claim.resolutionSummary ?? "") : null;

  return (
    <section className="grid gap-3" aria-label={hasVerdict ? t("titleSettled") : t("title")}>
      {tier ? (
        <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <StatusPill tone={tier === "refunded" ? "neutral" : "win"}>
            {t(`tier.${tier}`)}
            {claim.confidence > 0 ? ` · ${claim.confidence}%` : ""}
          </StatusPill>
          <span>{t(`hint.${tier}`)}</span>
        </p>
      ) : null}
      <ol className="m-0 grid list-decimal gap-1.5 pl-5 text-[13px] leading-relaxed text-cream marker:text-dim">
        {preview.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {hasVerdict ? (
        <Link href={`/verify/${claim.id}`} className="text-[14px] text-coral underline-offset-4 hover:underline">
          {t("verifyLink")}
        </Link>
      ) : null}
    </section>
  );
}
