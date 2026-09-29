"use client";

/**
 * The connected wallet's escrow betting balance (the virtual UserBalance that
 * lives in the Ephemeral Rollup) with a pull-withdraw back to the wallet's
 * USDC account. Payouts never land here — they go straight to the token
 * account — so this is unused deposit plus refunds of cancelled stakes.
 * Withdraw is never blocked by the program pause.
 */
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useState } from "react";
import { withdrawAllBalance, type BrowserMimir } from "@/lib/solana/browser-client";
import { formatUsdcUnits } from "@/lib/money";
import { txErrorMessage } from "@/lib/tx-errors";
import { explorerTx } from "./useSettleAction";

export default function BalanceCard({
  mimir,
  balance,
  onChanged,
}: {
  mimir: BrowserMimir | null;
  balance: bigint;
  onChanged?: () => void;
}) {
  const t = useTranslations("claimSettle");
  const [busy, setBusy] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);
  if (!mimir) return null;

  const withdraw = async () => {
    setBusy(true);
    try {
      const { units, sig } = await withdrawAllBalance(mimir);
      setLastSig(sig);
      toast.success(units > 0n ? t("withdrawnToast", { amount: formatUsdcUnits(units) }) : t("nothingToWithdraw"));
      onChanged?.();
    } catch (err) {
      toast.error(txErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card border-pv-border/25 bg-pv-surface p-5 sm:p-6" aria-label={t("balanceTitle")}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">{t("balanceTitle")}</p>
      <p className="mt-2 font-mono text-xl font-bold tabular-nums text-pv-gold">{formatUsdcUnits(balance)}</p>
      <p className="mt-1 text-xs leading-relaxed text-pv-muted">{t("balanceHint")}</p>
      <button
        type="button"
        className="btn-ghost mt-4 !w-auto !min-h-0 !px-4 !py-2 !text-xs disabled:opacity-50"
        disabled={busy || balance === 0n}
        onClick={withdraw}
      >
        {busy ? t("working") : t("withdrawButton")}
      </button>
      {lastSig ? (
        <a href={explorerTx(lastSig)} target="_blank" rel="noopener noreferrer" className="mt-2 block font-mono text-[10px] text-pv-muted hover:text-pv-emerald">
          ↗ {lastSig.slice(0, 20)}…
        </a>
      ) : null}
    </section>
  );
}
