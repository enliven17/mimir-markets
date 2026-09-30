"use client";

/**
 * /arena/[id]: one claim. The hero (question, both sides, pool, time left,
 * lifecycle) and one action dock (challenge, dispute, finalize, refund or pay
 * out, whichever applies now); everything else sits in tabs: evidence,
 * council, challengers, terms.
 *
 * Challenging is the three-step flow, the first two steps only once:
 *   1. deposit USDC into the Mimir escrow vault   (base layer)
 *   2. delegate the balance PDA to the ER          (base layer)
 *   3. challenge                                   (Ephemeral Rollup, ~30ms)
 * The claim and the viewer's rollup balance are re-read every 4s.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import { Link } from "@/i18n/navigation";
import { useBrowserMimir, depositUsdc, delegateBalance, challengeInER, getVirtualBalance } from "@/lib/solana/browser-client-lazy";
import type { ApiClaim } from "@/lib/server/arena-claim";
import { isLiveState } from "@/lib/claim-status";
import { formatUsdcUnits } from "@/lib/money";
import { txErrorMessage } from "@/lib/tx-errors";
import { buttonClass } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useWalletSheet } from "@/components/wallet/WalletSheetProvider";
import { useWalletTiers } from "@/components/token/useWalletTiers";
import { useNowSec } from "@/components/arena/settlement/useSettleAction";
import CouncilVotes from "@/components/arena/CouncilVotes";
import Hero from "@/components/arena/detail/Hero";
import ActionDock, { type ChallengeState } from "@/components/arena/detail/ActionDock";
import DetailTabs from "@/components/arena/detail/DetailTabs";
import EvidenceCard from "@/components/arena/detail/EvidenceCard";
import ChallengersList from "@/components/arena/detail/ChallengersList";
import DetailsDisclosures from "@/components/arena/detail/DetailsDisclosures";
import BalanceSheet from "@/components/arena/detail/BalanceSheet";

const POLL_MS = 4000;

export default function ArenaClaimPage() {
  const t = useTranslations("arena.detail");
  const params = useParams<{ id: string; locale: string }>();
  const wallet = useWallet();
  const { open: openWalletSheet } = useWalletSheet();
  // Phase changes on a coarse clock; countdowns in the hero and dock tick on their own.
  const now = useNowSec(15_000);
  const [claim, setClaim] = useState<ApiClaim | null>(null);
  const [missing, setMissing] = useState(false);
  const [balance, setBalance] = useState<bigint>(0n);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeState>({ stake: "2", busy: null, log: [], lastSig: null });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mimir = useBrowserMimir(wallet);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/arena/${encodeURIComponent(params.id)}`);
      const json = await res.json();
      if (json.success && json.data) {
        // Same data as last poll: keep the old object so nothing re-renders.
        setClaim((prev) => (prev && JSON.stringify(prev) === JSON.stringify(json.data) ? prev : (json.data as ApiClaim)));
        setMissing(false);
      } else if (res.status === 404 || res.status === 400) setMissing(true);
    } catch {}
    if (mimir) {
      try {
        const next = await getVirtualBalance(mimir);
        setBalance((prev) => (prev === next ? prev : next));
      } catch {}
    }
  }, [params.id, mimir]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const setBusy = (busy: string | null) => setChallenge((c) => ({ ...c, busy }));
  const pushLog = (line: string) => setChallenge((c) => ({ ...c, log: [...c.log, line] }));

  const onChallenge = async () => {
    if (!mimir || !claim) return;
    const units = BigInt(Math.round(Number(challenge.stake) * 1e6));
    setChallenge((c) => ({ ...c, log: [] }));
    try {
      if (balance < units) {
        setBusy(t("dock.busyDeposit"));
        const depositAmount = units > 20_000_000n ? units : 20_000_000n; // top up at least 20 USDC
        await depositUsdc(mimir, depositAmount);
        pushLog(`✓ ${t("dock.logDeposited", { amount: formatUsdcUnits(depositAmount) })}`);
        setBusy(t("dock.busyDelegate"));
        await delegateBalance(mimir);
        pushLog(`✓ ${t("dock.logDelegated")}`);
        await new Promise((r) => setTimeout(r, 2500));
      }
      setBusy(t("dock.busyChallenge"));
      const t0 = Date.now();
      const sig = await challengeInER(mimir, BigInt(claim.id), units);
      setChallenge((c) => ({ ...c, lastSig: sig }));
      pushLog(`⚡ ${t("dock.logLanded", { ms: Date.now() - t0 })}`);
      await refresh();
    } catch (err) {
      pushLog(`✗ ${txErrorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  // Holder badges: one batched tier read per new set of wallets.
  const tiers = useWalletTiers(claim ? [claim.creator, ...claim.challengers.map((c) => c.addr)] : []);

  if (!claim) {
    if (missing) {
      return (
        <div className="mx-auto grid max-w-[var(--wrap-narrow)] gap-6 py-16">
          <h1 className="sr-only">{t("notFound")}</h1>
          <EmptyState
            action={
              <Link href="/arena" className={buttonClass("light", "sm")}>
                {t("notFoundCta")}
              </Link>
            }
          >
            {t("notFound")}
          </EmptyState>
        </div>
      );
    }
    return (
      <div className="mx-auto grid w-full max-w-[1040px] gap-5" role="status" aria-label={t("loading")}>
        <h1 className="sr-only">{t("loading")}</h1>
        <Skeleton className="h-8 w-40 rounded-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-3/4" />
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      </div>
    );
  }

  const viewer = wallet.publicKey?.toBase58() ?? null;
  const live = isLiveState(claim.state) && claim.deadline > now;
  const stakeUnits = BigInt(Math.max(0, Math.round(Number(challenge.stake) * 1e6) || 0));

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1040px] grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-8 lg:gap-y-8">
      <Hero claim={claim} now={now} tiers={tiers} className="lg:col-start-1 lg:row-start-1" />

      <aside
        aria-label={t("dockLabel")}
        className={`z-30 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 ${live ? "max-lg:sticky max-lg:bottom-3" : ""}`}
      >
        <div className="lg:sticky lg:top-[96px]">
          <ActionDock
            claim={claim}
            now={now}
            mimir={mimir}
            viewer={viewer}
            balance={balance}
            challenge={challenge}
            onStake={(stake) => setChallenge((c) => ({ ...c, stake }))}
            onChallenge={() => void onChallenge()}
            onChanged={() => void refresh()}
            onManageBalance={() => setBalanceOpen(true)}
            onConnect={openWalletSheet}
          />
        </div>
      </aside>

      <DetailTabs
        className="lg:col-start-1 lg:row-start-2"
        counts={{ people: claim.challengers.length }}
        panels={{
          evidence: <EvidenceCard claim={claim} />,
          council: <CouncilVotes claimId={claim.id} claimState={claim.state} winnerSide={claim.winnerSide} />,
          people: <ChallengersList claim={claim} viewer={viewer} tiers={tiers} />,
          terms: <DetailsDisclosures claim={claim} now={now} stakeUnits={stakeUnits} lastSig={challenge.lastSig} />,
        }}
      />

      <BalanceSheet
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        mimir={mimir}
        balance={balance}
        onChanged={() => void refresh()}
      />
    </div>
  );
}
