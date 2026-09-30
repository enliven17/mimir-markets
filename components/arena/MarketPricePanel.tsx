"use client";

/**
 * The price of a live claim: what the money already staked implies, and what
 * taking the challenger side would pay. The derivation is stated, not implied.
 * Hidden once a verdict is in — a decided market has an outcome, not a price.
 */
import { TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ApiClaim } from "@/lib/server/arena-claim";
import { crowdImbalance, formatProbability, impliedOdds } from "@/lib/odds";
import { isLiveState } from "@/lib/claim-status";

/** Past this, one side is crowded enough that the contrarian case is worth naming. */
const CONTRARIAN_IMBALANCE = 0.5;

export default function MarketPricePanel({ claim }: { claim: ApiClaim }) {
  const t = useTranslations("marketPrice");
  if (!isLiveState(claim.state)) return null;
  const odds = impliedOdds(claim);
  const crowded =
    odds.creatorProbability !== null && crowdImbalance(odds) >= CONTRARIAN_IMBALANCE
      ? odds.creatorProbability > 0.5
        ? { crowded: claim.creatorPosition, thin: claim.counterPosition }
        : { crowded: claim.counterPosition, thin: claim.creatorPosition }
      : null;

  return (
    <section className="grid gap-3" aria-label={t("title")}>
      <p className="m-0 flex items-center gap-2 text-[12px] text-muted">
        <TrendingUp className="h-3.5 w-3.5" aria-hidden />
        {t("title")}
      </p>
      {odds.unpriced ? (
        <div className="grid gap-1 rounded-xl border border-dashed border-line-strong px-4 py-4">
          <p className="m-0 text-[14px] text-cream">{t("unpricedTitle")}</p>
          <p className="m-0 text-[13px] leading-relaxed text-muted">{t("unpricedBody")}</p>
        </div>
      ) : (
        <>
          <dl className="kv">
            <dt className="truncate" title={claim.creatorPosition}>{claim.creatorPosition}</dt>
            <dd className="text-cream">{formatProbability(odds.creatorProbability)}</dd>
            <dt className="truncate" title={claim.counterPosition}>{claim.counterPosition}</dt>
            <dd className="text-coral">{formatProbability(odds.challengerProbability)}</dd>
          </dl>
          {odds.challengerPayoutMultiple ? (
            <p className="m-0 text-[13px] text-cream">{t("cardPays", { multiple: odds.challengerPayoutMultiple.toFixed(2) })}</p>
          ) : null}
          {crowded && odds.challengerPayoutMultiple ? (
            <p className="m-0 rounded-xl bg-coral/[0.08] px-3.5 py-2.5 text-[13px] leading-relaxed text-pending">
              {t("contrarian", {
                pct: Math.round(Math.max(odds.creatorProbability!, odds.challengerProbability!) * 100),
                crowded: crowded.crowded,
                thin: crowded.thin,
                multiple: odds.challengerPayoutMultiple.toFixed(2),
              })}
            </p>
          ) : null}
          <p className="m-0 text-[12px] leading-relaxed text-muted">{t("poolExplainer")}</p>
        </>
      )}
    </section>
  );
}
