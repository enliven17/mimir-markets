"use client";

/**
 * Before settlement: how this claim will be decided (mirrors the oracle's
 * decision order). After a verdict: how firm it was, and a link to its audit
 * record on /verify.
 */
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ApiClaim } from "@/lib/server/arena-claim";
import { confidenceTier, settlementPreview, type ConfidenceTier } from "@/lib/settlement-preview";
import { displayedSide, isPendingVerdict } from "@/lib/claim-status";
import { ST_RESOLVED } from "@/lib/solana/config";

const TIER_CLASS: Record<ConfidenceTier, string> = {
  deterministic: "border-pv-gold/40 bg-pv-gold/[0.08] text-pv-gold",
  firm: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald",
  contested: "border-pv-border/40 bg-pv-surface2 text-pv-text",
  refunded: "border-pv-border/25 bg-pv-border/[0.04] text-pv-muted",
};

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
    <section className="card border-pv-border/25 bg-pv-surface p-5 sm:p-6" aria-label={t("title")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">
          {hasVerdict ? t("titleSettled") : t("title")}
        </h2>
        {tier ? (
          <span className={`border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${TIER_CLASS[tier]}`} title={t(`hint.${tier}`)}>
            {t(`tier.${tier}`)}
            {claim.confidence > 0 ? ` · ${claim.confidence}%` : ""}
          </span>
        ) : null}
      </div>
      {tier ? <p className="mb-3 text-xs text-pv-muted">{t(`hint.${tier}`)}</p> : null}
      <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-pv-text/90">
        {preview.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {hasVerdict ? (
        <Link
          href={`/verify/${claim.id}`}
          className="mt-4 inline-flex text-sm font-semibold text-pv-text underline decoration-pv-emerald/60 underline-offset-4 hover:decoration-pv-emerald"
        >
          {t("verifyLink")}
        </Link>
      ) : null}
    </section>
  );
}
