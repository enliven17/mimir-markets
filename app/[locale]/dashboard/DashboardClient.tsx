"use client";

/**
 * /dashboard — the connected wallet's side of Mimir: onboarding until the
 * first stake, balances (virtual balance in the ER or on base, USDC token
 * account, SOL), payouts it can pull now, a record, and every position it
 * holds as creator or challenger (from the read index). No mock data: empty
 * states say what to do next.
 */
import { useLocale, useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";

import { BlueprintHeading, BlueprintStat } from "@/components/BlueprintGrid";
import ClaimablePayouts from "@/components/dashboard/ClaimablePayouts";
import DashboardFilterBar from "@/components/dashboard/DashboardFilterBar";
import DashboardWalletGate from "@/components/dashboard/DashboardWalletGate";
import FundsPanel from "@/components/dashboard/FundsPanel";
import PositionList from "@/components/dashboard/PositionList";
import { OnboardingChecklistView } from "@/components/onboarding/OnboardingChecklist";
import HolderBadge from "@/components/token/HolderBadge";
import { useHolderTier } from "@/components/token/useHolderTier";
import PeepAvatar from "@/components/ui/PeepAvatar";
import { useDashboardFilterUrlState } from "@/hooks/useDashboardFilterUrlState";
import { useUserPositions } from "@/hooks/useUserPositions";
import { useWalletFunds } from "@/hooks/useWalletFunds";
import { applyDashboardFilters, summarizePositions } from "@/lib/dashboard-positions";
import { formatDashboardSnapshotAge } from "@/lib/dashboardSnapshotAge";
import { formatUsdcUnits } from "@/lib/money";

export default function DashboardClient() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const { publicKey, connected } = useWallet();
  const address = connected && publicKey ? publicKey.toBase58() : null;
  const funds = useWalletFunds();
  const positions = useUserPositions(address);
  const { filters, update, reset } = useDashboardFilterUrlState();
  // The connected wallet's tier: shares the header chip's request.
  const holder = useHolderTier();

  const heading = (
    <BlueprintHeading as="h1" eyebrow={t("eyebrow")} subtitle={t("subtitle")}>
      {t("title")}
    </BlueprintHeading>
  );

  if (!address) {
    return (
      <>
        {heading}
        <div className="px-4 pt-6 sm:px-6">
          <OnboardingChecklistView funds={funds} mimir={funds.mimir} hasStake={null} />
        </div>
        <DashboardWalletGate />
      </>
    );
  }

  const summary = summarizePositions(positions.claims, address);
  const filtered = applyDashboardFilters(positions.claims, filters, address);
  const hasStake = positions.loaded && !positions.error ? positions.claims.length > 0 : null;
  const refreshAll = () => {
    void positions.reload();
    void funds.reload();
  };
  const age = positions.indexedAt > 0 ? formatDashboardSnapshotAge(Date.now() - positions.indexedAt * 1000, locale) : null;

  return (
    <>
      {heading}
      <div className="flex min-w-0 items-center gap-2 border-b border-pv-border/25 px-4 py-3 sm:px-6">
        <PeepAvatar seed={`creator-${address}`} size={28} tone="accent" />
        <span className="min-w-0 truncate font-mono text-xs text-pv-text" title={address}>
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>
        <HolderBadge tier={holder.state?.tier} />
      </div>
      <OnboardingChecklistView funds={funds} mimir={funds.mimir} hasStake={hasStake} onFunded={funds.reload} className="mx-4 my-5 sm:mx-6" />

      <FundsPanel funds={funds} mimir={funds.mimir} onChanged={refreshAll} />
      <ClaimablePayouts claims={positions.claims} viewer={address} mimir={funds.mimir} onPaid={refreshAll} />

      {positions.claims.length > 0 ? (
        <section aria-label={t("recordAria")} className="bp-grid grid-cols-2 border-b border-pv-border/25 sm:grid-cols-4">
          <BlueprintStat value={summary.won} label={t("won")} />
          <BlueprintStat value={summary.lost} label={t("lost")} tone="text" />
          <BlueprintStat value={`${summary.winRate}%`} label={t("winRate")} />
          <BlueprintStat value={formatUsdcUnits(summary.atRisk)} label={t("atRisk")} tone="gold" />
        </section>
      ) : null}

      <section aria-labelledby="dashboard-positions" id="dashboard-positions-section">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-pv-border/25 px-4 pt-5 pb-3 sm:px-6">
          <h2 id="dashboard-positions" className="font-display text-lg font-bold uppercase tracking-tight text-pv-text">
            {t("positionsTitle")}
          </h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
            {t("total", { count: summary.total })}
            {age ? ` · ${t("indexed", { age })}` : ""}
            {summary.totalWon > 0n ? ` · ${t("totalWon", { amount: formatUsdcUnits(summary.totalWon) })}` : ""}
          </p>
        </div>

        {positions.error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-pv-danger/40 bg-pv-danger/[0.06] px-4 py-3 sm:px-6">
            <p className="text-xs text-pv-danger">{t("loadFailed")}</p>
            <button type="button" onClick={() => void positions.reload()} className="btn-ghost !w-auto !min-h-0 !px-3 !py-1.5 !text-[11px]">
              {t("retry")}
            </button>
          </div>
        ) : null}

        <DashboardFilterBar
          filters={filters}
          counts={{ all: summary.total, ...summary.counts }}
          onChange={update}
          onRefresh={refreshAll}
          refreshing={positions.refreshing}
        />
        <PositionList
          claims={filtered}
          viewer={address}
          totalCount={positions.claims.length}
          loading={!positions.loaded}
          onResetFilters={reset}
        />
      </section>
    </>
  );
}
