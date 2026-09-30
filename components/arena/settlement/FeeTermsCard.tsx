"use client";

/**
 * The claim's frozen terms: profit-only fees, dispute window and resolution
 * grace, snapshotted onto the claim at creation so a later policy change never
 * touches a market people already entered. Quotes what a challenger staking
 * `stakeUnits` would net if the challengers win. Unstyled block: it sits in a
 * disclosure on the claim page.
 */
import { useTranslations } from "next-intl";
import type { ApiClaim } from "@/lib/server/arena-claim";
import { challengerGross, splitFees } from "@/lib/solana/fees";
import { formatUsdcUnits } from "@/lib/money";

function hours(seconds: number): string {
  if (seconds <= 0) return "0h";
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  return `${Math.round(seconds / 360) / 10}h`;
}

export default function FeeTermsCard({ claim, stakeUnits }: { claim: ApiClaim; stakeUnits: bigint }) {
  const t = useTranslations("claimSettle");
  const creatorStake = BigInt(claim.creatorStake);
  const total = BigInt(claim.totalChallengerStake) + stakeUnits;
  const leg = stakeUnits > 0n ? challengerGross(2, stakeUnits, creatorStake, total) : null;
  const split = leg
    ? splitFees({
        gross: leg.gross,
        principal: leg.principal,
        policy: {
          platformFeeBps: claim.platformFeeBps,
          agentOwnerFeeBps: 0,
          platformRecipient: claim.platformFeeBps > 0 ? "platform" : null,
        },
        winner: "you",
      })
    : null;
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

  return (
    <div className="grid gap-3" aria-label={t("feesTitle")}>
      <dl className="kv">
        <dt>{t("platformFee")}</dt>
        <dd>
          {pct(claim.platformFeeBps)} {t("ofProfit")}
        </dd>
        <dt>{t("agentFee")}</dt>
        <dd>
          {pct(claim.agentFeeBps)} {t("ofProfit")}
        </dd>
        <dt>{t("disputeWindow")}</dt>
        <dd>{hours(claim.disputeWindow)}</dd>
        <dt>{t("refundGrace")}</dt>
        <dd>{hours(claim.resolutionGrace)}</dd>
      </dl>
      {split && leg ? (
        <p className="m-0 text-[13px] leading-relaxed text-cream">
          {t("feesExample", {
            stake: formatUsdcUnits(stakeUnits),
            gross: formatUsdcUnits(leg.gross),
            fee: formatUsdcUnits(split.totalFees),
            net: formatUsdcUnits(split.netPayout),
          })}
        </p>
      ) : null}
      <p className="m-0 text-[13px] leading-relaxed text-muted">{t("feesHint")}</p>
      {claim.totalFees !== "0" ? (
        <p className="m-0 font-mono text-[12px] text-muted">{t("feesCharged", { fees: formatUsdcUnits(claim.totalFees) })}</p>
      ) : null}
    </div>
  );
}
