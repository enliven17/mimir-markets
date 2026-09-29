"use client";

/**
 * The claim's frozen terms: profit-only fees, dispute window and resolution
 * grace, snapshotted onto the claim at creation so a later policy change never
 * touches a market people already entered. Quotes what a challenger staking
 * `stakeUnits` would net if the challengers win.
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
    <section className="card border-pv-border/25 bg-pv-surface p-5 sm:p-6" aria-label={t("feesTitle")}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">{t("feesTitle")}</p>
      <p className="mt-1 text-xs leading-relaxed text-pv-muted">{t("feesHint")}</p>
      <dl className="mt-4 grid grid-cols-2 gap-px border border-pv-border/25 bg-pv-border/25 text-sm">
        <div className="bg-pv-bg px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">{t("platformFee")}</dt>
          <dd className="mt-1 font-mono tabular-nums text-pv-text">{pct(claim.platformFeeBps)} {t("ofProfit")}</dd>
        </div>
        <div className="bg-pv-bg px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">{t("agentFee")}</dt>
          <dd className="mt-1 font-mono tabular-nums text-pv-text">{pct(claim.agentFeeBps)} {t("ofProfit")}</dd>
        </div>
        <div className="bg-pv-bg px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">{t("disputeWindow")}</dt>
          <dd className="mt-1 font-mono tabular-nums text-pv-text">{hours(claim.disputeWindow)}</dd>
        </div>
        <div className="bg-pv-bg px-3 py-2.5">
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">{t("refundGrace")}</dt>
          <dd className="mt-1 font-mono tabular-nums text-pv-text">{hours(claim.resolutionGrace)}</dd>
        </div>
      </dl>
      {split && leg ? (
        <p className="mt-3 text-xs leading-relaxed text-pv-muted">
          {t("feesExample", {
            stake: formatUsdcUnits(stakeUnits),
            gross: formatUsdcUnits(leg.gross),
            fee: formatUsdcUnits(split.totalFees),
            net: formatUsdcUnits(split.netPayout),
          })}
        </p>
      ) : null}
      {claim.totalFees !== "0" ? (
        <p className="mt-2 font-mono text-[11px] text-pv-muted">{t("feesCharged", { fees: formatUsdcUnits(claim.totalFees) })}</p>
      ) : null}
    </section>
  );
}
