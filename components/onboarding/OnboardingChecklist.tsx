"use client";

/**
 * First-stake checklist for Solana devnet: connect a wallet, get devnet SOL,
 * get devnet USDC, deposit + delegate to the Ephemeral Rollup, stake once.
 *
 * Every step is read from chain rather than ticked by hand (see
 * `lib/onboarding.ts`), so it stays honest if someone funds from another tab or
 * stakes through an agent. It collapses on its own once everything is done and
 * can be dismissed for good.
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { toast } from "sonner";
import { Check, ChevronDown, ExternalLink, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
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

const actionClass =
  "focus-ring inline-flex min-h-[40px] items-center justify-center gap-1.5 border px-3.5 py-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] transition-colors disabled:cursor-wait disabled:opacity-60";
const primaryAction = `${actionClass} border-pv-emerald bg-pv-emerald text-pv-bg hover:brightness-110`;
const secondaryAction = `${actionClass} border-pv-border/25 text-pv-text no-underline hover:border-pv-emerald/60 hover:bg-pv-surface2`;

const sol = (lamports: bigint) => (Number(lamports) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 });

export interface OnboardingChecklistViewProps {
  funds: WalletFunds;
  mimir: BrowserMimir | null;
  hasStake: boolean | null;
  onFunded?: () => void;
  className?: string;
}

/** Self-fetching checklist for pages that do not already read the wallet's funds. */
export default function OnboardingChecklist({ className = "" }: { className?: string }) {
  const { publicKey } = useWallet();
  const funds = useWalletFunds();
  const positions = useUserPositions(publicKey?.toBase58() ?? null);
  const hasStake = positions.loaded && !positions.error ? positions.claims.length > 0 : null;
  return <OnboardingChecklistView funds={funds} mimir={funds.mimir} hasStake={hasStake} onFunded={funds.reload} className={className} />;
}

export function OnboardingChecklistView({ funds, mimir, hasStake, onFunded, className = "" }: OnboardingChecklistViewProps) {
  const t = useTranslations("onboarding");
  const headingId = useId();
  const listId = useId();
  const { connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  // null until localStorage has been read, so dismissed users never see a flash
  // and the server render matches the first client render.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const [amount, setAmount] = useState("20");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setDismissed(readOnboardingDismissed()), []);

  const steps = onboardingSteps({ isConnected: connected, ...funds, hasStake });
  const doneCount = steps.filter((s) => s.done).length;
  const current = currentOnboardingStep(steps);
  const allDone = current === null;
  const expanded = expandedOverride ?? !allDone;

  if (dismissed !== false) return null;

  const dismiss = () => {
    writeOnboardingDismissed();
    setDismissed(true);
  };

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
          <button type="button" className={primaryAction} onClick={() => setVisible(true)} disabled={connecting}>
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
              className="input !w-24 !py-2 font-mono text-sm"
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
    const line = (text: string) => <p className="mt-1.5 font-mono text-[11px] text-pv-muted">{text}</p>;
    if (id === "sol") return line(funds.lamports === null ? t("loading") : t("steps.sol.balance", { amount: sol(funds.lamports) }));
    if (id === "usdc") return line(funds.usdcUnits === null ? t("loading") : t("steps.usdc.balance", { amount: formatUsdcUnits(funds.usdcUnits) }));
    if (id === "deposit") {
      if (funds.virtualUnits === null) return line(t("loading"));
      return line(t(`steps.deposit.balance.${funds.layer ?? "none"}`, { amount: formatUsdcUnits(funds.virtualUnits) }));
    }
    return null;
  };

  return (
    <section aria-labelledby={headingId} className={`overflow-hidden border border-pv-border/25 bg-pv-surface ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <h2 id={headingId} className="min-w-0 flex-1 font-display text-xs font-bold uppercase tracking-[0.16em] text-pv-text sm:text-sm">
          {allDone ? t("complete") : t("title")}
        </h2>
        <span className="font-mono text-xs tabular-nums text-pv-muted" aria-label={t("progressAria", { done: doneCount, total: steps.length })}>
          {t("progress", { done: doneCount, total: steps.length })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="focus-ring inline-flex min-h-[40px] items-center gap-1 px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-pv-muted transition-colors hover:text-pv-text"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpandedOverride(!expanded)}
          >
            {expanded ? t("hide") : t("show")}
            <ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden />
          </button>
          <button
            type="button"
            className="focus-ring inline-flex size-10 items-center justify-center text-pv-muted transition-colors hover:text-pv-text"
            aria-label={t("dismissAria")}
            title={t("dismiss")}
            onClick={dismiss}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div
        className="h-1 w-full bg-pv-border/[0.08]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={doneCount}
        aria-labelledby={headingId}
      >
        <div
          className="h-full bg-pv-emerald transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ol id={listId} hidden={!expanded} className="divide-y divide-pv-border/15">
        {steps.map((step, index) => {
          const isCurrent = step.id === current;
          return (
            <li key={step.id} aria-current={isCurrent ? "step" : undefined} className={`flex gap-3 px-4 py-4 sm:px-5 ${isCurrent ? "bg-pv-bg/60" : ""}`}>
              <span
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold ${
                  step.done
                    ? "border-pv-emerald bg-pv-emerald text-pv-bg"
                    : isCurrent
                      ? "border-pv-text text-pv-text"
                      : "border-pv-border/25 text-pv-muted"
                }`}
                aria-hidden
              >
                {step.done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className={`text-sm font-semibold ${step.done ? "text-pv-muted line-through decoration-pv-muted/50" : "text-pv-text"}`}>
                  {t(`steps.${step.id}.title`)}
                  <span className="sr-only"> ({step.done ? t("stepDone") : t("stepPending")})</span>
                </h3>
                {!step.done ? (
                  <>
                    <p className="mt-1 text-xs leading-relaxed text-pv-muted">{t(`steps.${step.id}.desc`)}</p>
                    {renderDetail(step.id)}
                    <div className="mt-3 flex flex-wrap gap-2 empty:hidden">{renderActions(step.id)}</div>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
