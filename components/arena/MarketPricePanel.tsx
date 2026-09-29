"use client";

/**
 * The price of a live claim: what the money already staked implies, and what
 * taking the challenger side would pay. The derivation is stated, not implied.
 * Hidden once a verdict is in — a decided market has an outcome, not a price.
 */
import { TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ApiClaim } from "@/lib/server/arena-claim";
import { crowdImbalance, formatProbability, impliedOdds, oddsBarWidths } from "@/lib/odds";
import { isLiveState } from "@/lib/claim-status";

/** Past this, one side is crowded enough that the contrarian case is worth naming. */
const CONTRARIAN_IMBALANCE = 0.5;

export default function MarketPricePanel({ claim }: { claim: ApiClaim }) {
  const t = useTranslations("marketPrice");
  if (!isLiveState(claim.state)) return null;
  const odds = impliedOdds(claim);
  const widths = oddsBarWidths(odds);
  const crowded =
    odds.creatorProbability !== null && crowdImbalance(odds) >= CONTRARIAN_IMBALANCE
      ? odds.creatorProbability > 0.5
        ? { crowded: claim.creatorPosition, thin: claim.counterPosition }
        : { crowded: claim.counterPosition, thin: claim.creatorPosition }
      : null;

  return (
    <section className="card border-pv-border/25 bg-pv-surface p-5 sm:p-6" aria-label={t("title")}>
      <h2 className="mb-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">
        <TrendingUp className="h-3.5 w-3.5" aria-hidden />
        {t("title")}
      </h2>
      {odds.unpriced ? (
        <div className="border border-dashed border-pv-border/40 px-4 py-5 text-center">
          <p className="text-sm text-pv-text">{t("unpricedTitle")}</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] text-pv-muted">{t("unpricedBody")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px border border-pv-border/25 bg-pv-border/25">
            <div className="bg-pv-bg px-3 py-3">
              <p className="font-display text-2xl font-bold tabular-nums text-pv-cyan">{formatProbability(odds.creatorProbability)}</p>
              <p className="mt-1 line-clamp-2 text-[12px] text-pv-text/85">{claim.creatorPosition}</p>
            </div>
            <div className="bg-pv-bg px-3 py-3">
              <p className="font-display text-2xl font-bold tabular-nums text-pv-fuch">{formatProbability(odds.challengerProbability)}</p>
              <p className="mt-1 line-clamp-2 text-[12px] text-pv-text/85">{claim.counterPosition}</p>
            </div>
          </div>
          <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-pv-border/[0.07]" aria-hidden>
            <div className="h-full bg-pv-cyan/70" style={{ width: `${widths.creator}%` }} />
            <div className="h-full bg-pv-fuch/70" style={{ width: `${widths.challenger}%` }} />
          </div>
          <p className="mt-3 border-t border-pv-border/25 pt-3 text-[11px] leading-relaxed text-pv-muted">{t("poolExplainer")}</p>
          {crowded && odds.challengerPayoutMultiple ? (
            <p className="mt-2 border border-pv-fuch/25 bg-pv-fuch/[0.05] px-3 py-2 text-[11px] leading-relaxed text-pv-fuch">
              {t("contrarian", {
                pct: Math.round(Math.max(odds.creatorProbability!, odds.challengerProbability!) * 100),
                crowded: crowded.crowded,
                thin: crowded.thin,
                multiple: odds.challengerPayoutMultiple.toFixed(2),
              })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
