"use client";

/**
 * First-stake checklist for Solana devnet: connect a wallet, get devnet SOL,
 * get devnet USDC, deposit + delegate to the Ephemeral Rollup, stake once.
 *
 * Every step is read from chain rather than ticked by hand (see
 * `lib/onboarding.ts`), so it stays honest if someone funds from another tab or
 * stakes through an agent. Dismissal is remembered in localStorage.
 *
 * - `OnboardingBanner`: one dismissible line ("Deposit, delegate, challenge ·
 *   2 of 5 done · Continue") that opens the full checklist in a sheet.
 * - `OnboardingChecklistView`: the checklist itself, as a card or bare inside
 *   a sheet.
 */
import { PILL, SURFACE } from "@/components/arena/surface";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { Check, ChevronDown, ExternalLink, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Modal } from "@/components/ui";
import { useWalletSheet } from "@/components/wallet/WalletSheetProvider";
import { useUserPositions } from "@/hooks/useUserPositions";
import { useWalletFunds, type WalletFunds } from "@/hooks/useWalletFunds";
import { formatUsdcUnits } from "@/lib/money";
import {
  CIRCLE_FAUCET_URL,
  currentOnboardingStep,
  onboardingSteps,
  readOnboardingDismissed,
  SOLANA_FAUCET_URL,
  writeOnboardingDismissed,
  type OnboardingStepId,
} from "@/lib/onboarding";
import type { BrowserMimir } from "@/lib/solana/browser-client";
import { MIN_STAKE_UNITS, toUsdcUnits } from "@/lib/solana/config";
import { depositAndDelegate } from "@/lib/solana/fund-actions";
import { txErrorMessage } from "@/lib/tx-errors";

const primaryAction = "btn-compact-primary press min-h-[40px] gap-1.5 px-4 text-[14px]";
const secondaryAction =
  "glass press inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full px-4 text-[14px] text-cream shadow-chip no-underline transition-colors hover:bg-[rgba(34,20,22,.78)]";

const sol = (lamports: bigint) => (Number(lamports) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 });

export interface OnboardingChecklistViewProps {
  funds: WalletFunds;
  mimir: BrowserMimir | null;
  hasStake: boolean | null;
  onFunded?: () => void;
  className?: string;
  /** Inside a sheet: no card, no header (the sheet has the title). */
  bare?: boolean;
}

function useOnboardingData() {
  const { publicKey } = useWallet();
  const funds = useWalletFunds();
  const positions = useUserPositions(publicKey?.toBase58() ?? null);
  const hasStake = positions.loaded && !positions.error ? positions.claims.length > 0 : null;
  return { funds, hasStake };
}

/** null until localStorage has been read, so dismissed users never see a flash. */
function useDismissed() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => setDismissed(readOnboardingDismissed()), []);
  const dismiss = () => {
    writeOnboardingDismissed();
    setDismissed(true);
  };
  return { dismissed, dismiss };
}

/** Self-fetching checklist card for pages that do not already read the wallet's funds. */
export default function OnboardingChecklist({ className = "" }: { className?: string }) {
  const { funds, hasStake } = useOnboardingData();
  return <OnboardingChecklistView funds={funds} mimir={funds.mimir} hasStake={hasStake} onFunded={funds.reload} className={className} />;
}

/** One line with progress and Continue; the checklist opens in a sheet. Hidden once done or dismissed. */
export function OnboardingBanner({ className = "" }: { className?: string }) {
  const { funds, hasStake } = useOnboardingData();
  return <OnboardingBannerView funds={funds} hasStake={hasStake} className={className} />;
}

/** The banner over data the page already reads (the portfolio), so nothing is fetched twice. */
export function OnboardingBannerView({
  funds,
  hasStake,
  className = "",
}: {
  funds: ReturnType<typeof useWalletFunds>;
  hasStake: boolean | null;
  className?: string;
}) {
  const t = useTranslations("arena.feed");
  const { connected } = useWallet();
  const { dismissed, dismiss } = useDismissed();
  const [open, setOpen] = useState(false);

  const steps = onboardingSteps({ isConnected: connected, ...funds, hasStake });
  const done = steps.filter((s) => s.done).length;
  // Unknown (before the localStorage read) renders like "not dismissed", the
  // server HTML's state, so the banner never pops in and shoves the feed.
  if (dismissed === true || (currentOnboardingStep(steps) === null && !open)) return null;

  return (
    <>
      <div
        className={`${PILL} fade-rise flex min-h-[52px] items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5 text-[14px] ${className}`}
      >
        <span aria-hidden className="px-dot" />
        <span className="min-w-0 flex-1 truncate text-cream">
          {t("onboarding")}
          <span className="text-muted"> · {t("onboardingDone", { done, total: steps.length })}</span>
        </span>
        <button type="button" onClick={() => setOpen(true)} className="btn-light !min-h-[40px] !px-4 !text-[16px]">
          {t("onboardingContinue")}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("onboardingDismiss")}
          className="press grid h-10 w-10 flex-none place-items-center rounded-full text-muted transition-colors hover:text-cream"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t("onboardingSheet")} variant="sheet">
        <OnboardingChecklistView funds={funds} mimir={funds.mimir} hasStake={hasStake} onFunded={funds.reload} bare />
      </Modal>
    </>
  );
}

export function OnboardingChecklistView({ funds, mimir, hasStake, onFunded, className = "", bare = false }: OnboardingChecklistViewProps) {
  const t = useTranslations("onboarding");
  const headingId = useId();
  const listId = useId();
  const { connected, connecting } = useWallet();
  const { open: openWalletSheet } = useWalletSheet();
  const { dismissed, dismiss } = useDismissed();

  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const [amount, setAmount] = useState("20");
  const [busy, setBusy] = useState<string | null>(null);

  const steps = onboardingSteps({ isConnected: connected, ...funds, hasStake });
  const doneCount = steps.filter((s) => s.done).length;
  const current = currentOnboardingStep(steps);
  const allDone = current === null;
  const expanded = bare || (expandedOverride ?? !allDone);

  // As in the banner: unknown renders, so the card never pops in (no layout shift).
  if (!bare && dismissed === true) return null;

  const units = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? toUsdcUnits(n) : 0n;
  })();

  const deposit = async () => {
    if (!mimir || units < MIN_STAKE_UNITS) return;
    try {
      await depositAndDelegate(mimir, units, (step) => setBusy(t(`steps.deposit.busy.${step}`)));
      toast.success(t("steps.deposit.done", { amount: formatUsdcUnits(units) }));
      onFunded?.();
    } catch (err) {
      toast.error(txErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const external = (href: string, label: string, aria: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className={secondaryAction} aria-label={aria}>
      {label}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );

  const renderActions = (id: OnboardingStepId) => {
    switch (id) {
      case "connect":
        return (
          <button type="button" className={primaryAction} onClick={openWalletSheet} disabled={connecting}>
            {connecting ? t("steps.connect.connecting") : t("steps.connect.action")}
          </button>
        );
      case "sol":
        return external(SOLANA_FAUCET_URL, t("steps.sol.action"), t("steps.sol.aria"));
      case "usdc":
        return external(CIRCLE_FAUCET_URL, t("steps.usdc.action"), t("steps.usdc.aria"));
      case "deposit":
        if (!connected) return null;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${listId}-amount`}>
              {t("steps.deposit.amountLabel")}
            </label>
            <input
              id={`${listId}-amount`}
              type="number"
              min={2}
              step="1"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input !min-h-[40px] !w-24 !px-4 !py-2 font-mono !text-sm"
            />
            <button
              type="button"
              className={primaryAction}
              onClick={() => void deposit()}
              disabled={!mimir || !!busy || units < MIN_STAKE_UNITS || (funds.usdcUnits !== null && funds.usdcUnits < units)}
            >
              {busy ?? t("steps.deposit.action")}
            </button>
          </div>
        );
      case "stake":
        return (
          <>
            <Link href="/arena" className={secondaryAction}>
              {t("steps.stake.explore")}
            </Link>
            <Link href="/arena/create" className={secondaryAction}>
              {t("steps.stake.create")}
            </Link>
          </>
        );
    }
  };

  const renderDetail = (id: OnboardingStepId) => {
    if (!connected) return null;
    const line = (text: string) => <p className="mt-1.5 font-mono text-[12px] text-muted">{text}</p>;
    if (id === "sol") return line(funds.lamports === null ? t("loading") : t("steps.sol.balance", { amount: sol(funds.lamports) }));
    if (id === "usdc") return line(funds.usdcUnits === null ? t("loading") : t("steps.usdc.balance", { amount: formatUsdcUnits(funds.usdcUnits) }));
    if (id === "deposit") {
      if (funds.virtualUnits === null) return line(t("loading"));
      return line(t(`steps.deposit.balance.${funds.layer ?? "none"}`, { amount: formatUsdcUnits(funds.virtualUnits) }));
    }
    return null;
  };

  const list = (
    <ol id={listId} hidden={!expanded} className="m-0 grid list-none gap-1 p-0">
      {steps.map((step, index) => {
        const isCurrent = step.id === current;
        return (
          <li
            key={step.id}
            aria-current={isCurrent ? "step" : undefined}
            className={`flex gap-3 rounded-xl px-3 py-3.5 ${isCurrent ? "bg-cream/[0.04]" : ""}`}
          >
            <span
              className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px] ${
                step.done ? "bg-coral text-[#160909]" : isCurrent ? "bg-cream text-ink" : "bg-panel-2 text-muted"
              }`}
              aria-hidden
            >
              {step.done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className={`m-0 text-[15px] ${step.done ? "text-muted line-through decoration-muted/50" : "text-cream"}`}>
                {t(`steps.${step.id}.title`)}
                <span className="sr-only"> ({step.done ? t("stepDone") : t("stepPending")})</span>
              </h3>
              {!step.done && isCurrent ? (
                <>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(`steps.${step.id}.desc`)}</p>
                  {renderDetail(step.id)}
                  <div className="mt-3 flex flex-wrap gap-2 empty:hidden">{renderActions(step.id)}</div>
                </>
              ) : !step.done ? (
                <div className="mt-2 flex flex-wrap gap-2 empty:hidden">{renderActions(step.id)}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );

  const meter = (
    <div
      className="h-[3px] overflow-hidden rounded-[3px] bg-panel-2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={steps.length}
      aria-valuenow={doneCount}
      aria-label={t("progressAria", { done: doneCount, total: steps.length })}
    >
      <i
        className="block h-full origin-left bg-coral transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `scaleX(${doneCount / steps.length})` }}
      />
    </div>
  );

  if (bare) {
    return (
      <div className="grid gap-4">
        <p className="m-0 flex items-center justify-between text-[14px] text-muted">
          <span>{allDone ? t("complete") : t("title")}</span>
          <span className="font-mono tabular-nums">{t("progress", { done: doneCount, total: steps.length })}</span>
        </p>
        {meter}
        {list}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className={`${SURFACE} grid gap-3 p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={headingId} className="m-0 min-w-0 flex-1 text-[15px] text-cream">
          {allDone ? t("complete") : t("title")}
        </h2>
        <span className="font-mono text-[13px] tabular-nums text-muted" aria-hidden>
          {t("progress", { done: doneCount, total: steps.length })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="press inline-flex min-h-[40px] items-center gap-1 rounded-full px-3 text-[13px] text-muted transition-colors hover:text-cream"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpandedOverride(!expanded)}
          >
            {expanded ? t("hide") : t("show")}
            <ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden />
          </button>
          <button
            type="button"
            className="press grid size-10 place-items-center rounded-full text-muted transition-colors hover:text-cream"
            aria-label={t("dismissAria")}
            title={t("dismiss")}
            onClick={dismiss}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {meter}
      {list}
    </section>
  );
}
