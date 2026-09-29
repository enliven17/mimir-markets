"use client";

/**
 * Where the money is on a claim, sized for the feed card.
 *
 * Pool (pari-mutuel) odds only: each side's share of the pot. The bar sits
 * above both percentages with the position text next to each, so a reader can
 * match a number to the side it belongs to without opening the market. The
 * claim page has the full breakdown (MarketPricePanel).
 */
import { useTranslations } from "next-intl";
import { formatProbability, impliedOdds, oddsBarWidths, type StakeSplit } from "@/lib/odds";

interface OddsBarProps {
  split: StakeSplit;
  creatorPosition: string;
  challengerPosition: string;
  /** Adds the challenger payout line. */
  showPayout?: boolean;
}

export default function OddsBar({ split, creatorPosition, challengerPosition, showPayout = false }: OddsBarProps) {
  const t = useTranslations("marketPrice");
  const odds = impliedOdds(split);

  if (odds.unpriced) {
    return (
      <div className="space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-pv-border/[0.07]">
          <div
            className="h-full w-full bg-[repeating-linear-gradient(45deg,rgba(148,163,184,0.35)_0_6px,transparent_6px_12px)]"
            aria-hidden
          />
        </div>
        <p className="font-mono text-[10px] text-pv-muted">{t("cardUnpriced")}</p>
      </div>
    );
  }

  const widths = oddsBarWidths(odds);
  return (
    <div className="space-y-2">
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-pv-border/[0.07]"
        role="img"
        aria-label={t("cardAria", {
          creator: formatProbability(odds.creatorProbability),
          challenger: formatProbability(odds.challengerProbability),
        })}
      >
        <div className="h-full bg-pv-cyan/70" style={{ width: `${widths.creator}%` }} />
        <div className="h-full bg-pv-fuch/70" style={{ width: `${widths.challenger}%` }} />
      </div>
      <div className="flex items-start justify-between gap-3 text-[11px]">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="font-display font-bold tabular-nums text-pv-cyan">{formatProbability(odds.creatorProbability)}</span>
          <span className="truncate text-pv-text/70">{creatorPosition}</span>
        </div>
        <div className="flex min-w-0 items-baseline justify-end gap-1.5 text-right">
          <span className="truncate text-pv-text/70">{challengerPosition}</span>
          <span className="font-display font-bold tabular-nums text-pv-fuch">{formatProbability(odds.challengerProbability)}</span>
        </div>
      </div>
      {showPayout && odds.challengerPayoutMultiple !== null ? (
        <p className="font-mono text-[10px] text-pv-muted">
          {t("cardPays", { multiple: odds.challengerPayoutMultiple.toFixed(2) })}
        </p>
      ) : null}
    </div>
  );
}
