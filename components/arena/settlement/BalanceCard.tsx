"use client";

/**
 * The connected wallet's escrow betting balance (the virtual UserBalance that
 * lives in the Ephemeral Rollup) with a pull-withdraw back to the wallet's
 * USDC account, plus a deposit-and-delegate top-up. Payouts never land here
 * (they go straight to the token account), so this is unused deposit plus
 * refunds of cancelled stakes. Withdraw is never blocked by the program pause.
 * Unstyled block: it sits in the balance sheet on the claim page.
 */
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { BrowserMimir } from "@/lib/solana/browser-client";
import { withdrawAllBalance } from "@/lib/solana/browser-client-lazy";
import { depositAndDelegate } from "@/lib/solana/fund-actions";
import { MIN_STAKE_UNITS, toUsdcUnits } from "@/lib/solana/config";
import { formatUsdcUnits } from "@/lib/money";
import { txErrorMessage } from "@/lib/tx-errors";
import Button from "@/components/ui/Button";
import { explorerTx } from "./useSettleAction";

export default function BalanceCard({
  mimir,
  balance,
  walletUsdc = null,
  onChanged,
}: {
  mimir: BrowserMimir | null;
  balance: bigint;
  /** USDC in the wallet's token account; null while unknown. */
  walletUsdc?: bigint | null;
  onChanged?: () => void;
}) {
  const t = useTranslations("claimSettle");
  const tb = useTranslations("arena.detail.balanceSheet");
  const to = useTranslations("onboarding.steps.deposit");
  const amountId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState("20");
  const [lastSig, setLastSig] = useState<string | null>(null);
  if (!mimir) return null;

  const units = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? toUsdcUnits(n) : 0n;
  })();

  const withdraw = async () => {
    setBusy("withdraw");
    try {
      const { units: out, sig } = await withdrawAllBalance(mimir);
      setLastSig(sig);
      toast.success(out > 0n ? t("withdrawnToast", { amount: formatUsdcUnits(out) }) : t("nothingToWithdraw"));
      onChanged?.();
    } catch (err) {
      toast.error(txErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const deposit = async () => {
    if (units < MIN_STAKE_UNITS) return;
    try {
      const sig = await depositAndDelegate(mimir, units, (step) => setBusy(to(`busy.${step}`)));
      setLastSig(sig);
      toast.success(to("done", { amount: formatUsdcUnits(units) }));
      onChanged?.();
    } catch (err) {
      toast.error(txErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5">
      <dl className="kv">
        <dt>{t("balanceTitle")}</dt>
        <dd className="text-cream">{formatUsdcUnits(balance)}</dd>
        <dt>{tb("wallet")}</dt>
        <dd>{walletUsdc === null ? "-" : formatUsdcUnits(walletUsdc)}</dd>
      </dl>

      <div className="grid gap-2.5">
        <p className="m-0 text-[15px] text-cream">{tb("depositTitle")}</p>
        <p className="m-0 text-[13px] leading-relaxed text-muted">{tb("depositHint")}</p>
        <div className="flex items-center gap-2">
          <label htmlFor={amountId} className="sr-only">
            {to("amountLabel")}
          </label>
          <input
            id={amountId}
            type="number"
            min={2}
            step="1"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input !min-h-[46px] !w-28 !px-4 font-mono !text-[15px]"
          />
          <Button
            size="sm"
            className="flex-1"
            loading={!!busy && busy !== "withdraw"}
            disabled={!!busy || units < MIN_STAKE_UNITS || (walletUsdc !== null && walletUsdc < units)}
            onClick={() => void deposit()}
          >
            {busy && busy !== "withdraw" ? busy : to("action")}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 border-t border-line pt-4">
        <p className="m-0 text-[13px] leading-relaxed text-muted">{t("balanceHint")}</p>
        <Button size="sm" variant="ghost" data-action="withdraw" loading={busy === "withdraw"} disabled={!!busy || balance === 0n} onClick={() => void withdraw()}>
          {busy === "withdraw" ? t("working") : t("withdrawButton")}
        </Button>
        {lastSig ? (
          <a href={explorerTx(lastSig)} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] text-muted hover:text-coral">
            ↗ {lastSig.slice(0, 20)}…
          </a>
        ) : null}
      </div>
    </div>
  );
}
