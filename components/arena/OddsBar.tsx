"use client";

/**
 * Where the money is on a claim: a thin two-colour bar (cream = creator side,
 * coral = challenger side) with each side's label and pool share under it.
 * Pool (pari-mutuel) odds only. With no counter-stake there is no price, so
 * the bar is hatched and says so.
 */
import { useTranslations } from "next-intl";
import { formatProbability, impliedOdds, oddsBarWidths, type StakeSplit } from "@/lib/odds";

interface OddsBarProps {
  split: StakeSplit;
  creatorPosition: string;
  challengerPosition: string;
  /** Adds the challenger payout line. */
  showPayout?: boolean;
  className?: string;
}

export default function OddsBar({ split, creatorPosition, challengerPosition, showPayout = false, className = "" }: OddsBarProps) {
  const t = useTranslations("marketPrice");
  const odds = impliedOdds(split);
  const widths = oddsBarWidths(odds);

  return (
    <div className={`grid gap-2 ${className}`}>
      <SplitBar
        creator={widths.creator}
        unpriced={odds.unpriced}
        label={
          odds.unpriced
            ? t("cardUnpriced")
            : t("cardAria", {
                creator: formatProbability(odds.creatorProbability),
                challenger: formatProbability(odds.challengerProbability),
              })
        }
      />
      <div className="grid grid-cols-2 gap-3 text-[13px] leading-snug">
        <p className="m-0 flex min-w-0 items-baseline gap-1.5">
          <span className="font-mono tabular-nums text-cream">{formatProbability(odds.creatorProbability)}</span>
          <span className="truncate text-muted" title={creatorPosition}>
            {creatorPosition}
          </span>
        </p>
        <p className="m-0 flex min-w-0 items-baseline justify-end gap-1.5 text-right">
          <span className="truncate text-muted" title={challengerPosition}>
            {challengerPosition}
          </span>
          <span className="font-mono tabular-nums text-coral">{formatProbability(odds.challengerProbability)}</span>
        </p>
      </div>
      {showPayout && odds.challengerPayoutMultiple !== null ? (
        <p className="m-0 text-[12px] text-muted">{t("cardPays", { multiple: odds.challengerPayoutMultiple.toFixed(2) })}</p>
      ) : null}
    </div>
  );
}

/**
 * The two-colour pool split: a coral track with the cream creator share
 * scaled over it from the left. Only `transform` animates. Hatched when there
 * is no counter-stake yet.
 */
export function SplitBar({
  creator,
  unpriced,
  label,
  className = "h-[5px]",
}: {
  /** Creator share, 0..100. */
  creator: number;
  unpriced: boolean;
  /** Accessible description; omit to hide the bar from assistive tech. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[3px] ${unpriced ? "bg-[repeating-linear-gradient(135deg,rgb(243_234_214/.28)_0_5px,transparent_5px_10px)]" : "bg-coral"} ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {unpriced ? null : (
        <i
          className="absolute inset-y-0 left-0 block w-full origin-left bg-cream shadow-[3px_0_0_rgb(17_15_14)] transition-transform duration-700 ease-out"
          style={{ transform: `scaleX(${creator / 100})` }}
        />
      )}
    </div>
  );
}
