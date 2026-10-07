"use client";

/**
 * /dashboard (Portfolio): the connected wallet's side of Mimir. The Mimir
 * balance is the hero number with Deposit and Withdraw (both open the balance
 * sheet), the record in one line, a one-line setup banner until the first
 * stake, "Ready to claim" only when payouts exist, then every position it
 * holds as creator or challenger with phase tabs, search and filters in the
 * URL. No mock data: empty states say what to do next.
 */
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";

import { SURFACE } from "@/components/arena/surface";
import ArcDashboard from "@/components/arc/dashboard/ArcDashboard";
import PullToRefresh from "@/components/app/PullToRefresh";
import { arcArenaEnabled } from "@/components/arc/arena/enabled";
import ClaimablePayouts from "@/components/dashboard/ClaimablePayouts";
import DashboardFilterBar from "@/components/dashboard/DashboardFilterBar";
import DashboardWalletGate from "@/components/dashboard/DashboardWalletGate";
import FundsPanel, { type FundsAction } from "@/components/dashboard/FundsPanel";
import PositionList from "@/components/dashboard/PositionList";
import { OnboardingBannerView } from "@/components/onboarding/OnboardingChecklist";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import { useDashboardFilterUrlState } from "@/hooks/useDashboardFilterUrlState";
import { useUserPositions } from "@/hooks/useUserPositions";
import { useWalletFunds } from "@/hooks/useWalletFunds";
import { applyDashboardFilters, summarizePositions } from "@/lib/dashboard-positions";
import { formatDashboardSnapshotAge } from "@/lib/dashboardSnapshotAge";
import { formatUsdcUnits, formatUsdcUnitsBare } from "@/lib/money";

const sol = (lamports: bigint | null) =>
  lamports === null ? "…" : (Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Arc once its contracts and Convex are configured; the Solana portfolio until then. */
export default function DashboardClient() {
  return arcArenaEnabled ? (
    <PullToRefresh>
      <ArcDashboard />
    </PullToRefresh>
  ) : (
    <SolanaDashboard />
  );
}

function SolanaDashboard() {
  const t = useTranslations("dashboard");
  const { publicKey, connected } = useWallet();
  const address = connected && publicKey ? publicKey.toBase58() : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
        {address ? (
          <span className="truncate font-mono text-[13px] text-muted" title={address}>
            {address.slice(0, 4)}…{address.slice(-4)}
          </span>
        ) : null}
      </header>
      {address ? <Connected address={address} /> : <DashboardWalletGate />}
    </div>
  );
}

function Connected({ address }: { address: string }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const funds = useWalletFunds();
  const positions = useUserPositions(address);
  const { filters, update, reset } = useDashboardFilterUrlState();
  const [sheet, setSheet] = useState<FundsAction | null>(null);

  const summary = summarizePositions(positions.claims, address);
  const filtered = applyDashboardFilters(positions.claims, filters, address);
  const hasStake = positions.loaded && !positions.error ? positions.claims.length > 0 : null;
  const refreshAll = () => {
    void positions.reload();
    void funds.reload();
  };
  const age = positions.indexedAt > 0 ? formatDashboardSnapshotAge(Date.now() - positions.indexedAt * 1000, locale) : null;
  const layer = funds.layer ?? "none";

  return (
    <>
      <section aria-label={t(`virtual.${layer}`)} className={`${SURFACE} grid gap-5 p-5 sm:flex sm:items-end sm:justify-between sm:p-7`}>
        <div className="min-w-0">
          <p className="m-0 text-[13px] text-muted">{t(`virtual.${layer}`)}</p>
          <p className="m-0 mt-2 flex h-[clamp(2.6rem,11vw,3.6rem)] items-center font-mono text-[clamp(2.3rem,10vw,3.4rem)] leading-none tabular-nums text-cream">
            {funds.virtualUnits === null ? (
              <Skeleton className="h-[70%] w-40" />
            ) : (
              <>
                <span className="mr-1 text-[0.6em] text-muted">$</span>
                {formatUsdcUnitsBare(funds.virtualUnits)}
              </>
            )}
          </p>
          <p className="m-0 mt-2 text-[13px] text-muted">
            {t("walletLine", { usdc: funds.usdcUnits === null ? "…" : formatUsdcUnits(funds.usdcUnits), sol: sol(funds.lamports) })}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-none">
          <Button size="sm" onClick={() => setSheet("deposit")} className="sm:!w-auto">
            {t("deposit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSheet("withdraw")} disabled={!funds.virtualUnits} className="sm:!w-auto">
            {t("withdraw")}
          </Button>
        </div>
      </section>

      {positions.claims.length > 0 ? (
        <p aria-label={t("recordAria")} className="m-0 -mt-2 text-[14px] text-muted sm:-mt-4">
          {t("record", {
            won: summary.won,
            lost: summary.lost,
            rate: summary.winRate,
            atRisk: formatUsdcUnits(summary.atRisk),
          })}
        </p>
      ) : null}

      <OnboardingBannerView funds={funds} hasStake={hasStake} />

      <ClaimablePayouts claims={positions.claims} viewer={address} mimir={funds.mimir} onPaid={refreshAll} />

      <section aria-labelledby="dashboard-positions" id="dashboard-positions-section" className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="dashboard-positions" className="m-0 font-display text-[1.6rem] leading-none text-cream">
            {t("positionsTitle")}
          </h2>
          <p className="m-0 text-[13px] text-muted">
            {t("total", { count: summary.total })}
            {summary.totalWon > 0n ? ` · ${t("totalWon", { amount: formatUsdcUnits(summary.totalWon) })}` : ""}
            {age ? ` · ${t("indexed", { age })}` : ""}
          </p>
        </div>

        {positions.error ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-danger/[0.1] py-2 pl-4 pr-2 text-[14px] text-danger">
            <span className="min-w-0">{t("loadFailed")}</span>
            <Button size="sm" variant="ghost" fullWidth={false} className="!min-h-[36px] !px-4 !text-[14px]" onClick={() => void positions.reload()}>
              {t("retry")}
            </Button>
          </div>
        ) : null}

        <DashboardFilterBar
          filters={filters}
          counts={{ all: summary.total, ...summary.counts }}
          onChange={update}
          onRefresh={refreshAll}
          refreshing={positions.refreshing}
          resultCount={filtered.length}
        />
        <PositionList
          claims={filtered}
          viewer={address}
          totalCount={positions.claims.length}
          loading={!positions.loaded}
          onResetFilters={reset}
        />
      </section>

      <FundsPanel
        open={sheet !== null}
        action={sheet ?? "deposit"}
        onClose={() => setSheet(null)}
        funds={funds}
        mimir={funds.mimir}
        onChanged={refreshAll}
      />
    </>
  );
}
