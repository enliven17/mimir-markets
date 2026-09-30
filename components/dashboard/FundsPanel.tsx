"use client";

/**
 * Where the wallet's money is: USDC in its token account, the Mimir virtual
 * balance (base layer or delegated to the Ephemeral Rollup) and SOL for fees.
 * Withdraw pulls the whole free virtual balance back to the token account,
 * undelegating it from the rollup first when needed (never paused).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { BlueprintStat } from "@/components/BlueprintGrid";
import type { WalletFunds } from "@/hooks/useWalletFunds";
import type { BrowserMimir } from "@/lib/solana/browser-client";
import { withdrawAllBalance } from "@/lib/solana/browser-client-lazy";
import { formatUsdcUnits } from "@/lib/money";
import { txErrorMessage } from "@/lib/tx-errors";

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const fmt = (v: bigint | null) => (v === null ? "…" : formatUsdcUnits(v));

export default function FundsPanel({ funds, mimir, onChanged }: { funds: WalletFunds; mimir: BrowserMimir | null; onChanged: () => void }) {
  const t = useTranslations("dashboard");
  const [busy, setBusy] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);

  const withdraw = async () => {
    if (!mimir) return;
    setBusy(true);
    try {
      const { units, sig } = await withdrawAllBalance(mimir);
      setLastSig(sig);
      toast.success(units > 0n ? t("withdrawn", { amount: formatUsdcUnits(units) }) : t("nothingToWithdraw"));
      onChanged();
    } catch (err) {
      toast.error(txErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const layer = funds.layer ?? "none";
  return (
    <section aria-label={t("fundsAria")}>
      <div className="bp-grid grid-cols-1 border-b border-pv-border/25 sm:grid-cols-3">
        <BlueprintStat value={fmt(funds.virtualUnits)} label={t(`virtual.${layer}`)} tone="gold" />
        <BlueprintStat value={fmt(funds.usdcUnits)} label={t("walletUsdc")} tone="text" />
        <BlueprintStat
          value={funds.lamports === null ? "…" : (Number(funds.lamports) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 })}
          label={t("walletSol")}
          tone="text"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pv-border/25 px-4 py-3 sm:px-6">
        <p className="max-w-xl text-xs leading-relaxed text-pv-muted">{t("fundsHint")}</p>
        <div className="flex items-center gap-3">
          {lastSig ? (
            <a href={explorerTx(lastSig)} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] text-pv-muted hover:text-pv-emerald">
              ↗ {lastSig.slice(0, 12)}…
            </a>
          ) : null}
          <button
            type="button"
            className="btn-ghost !w-auto !min-h-0 !px-4 !py-2 !text-xs disabled:opacity-50"
            disabled={busy || !mimir || !funds.virtualUnits}
            onClick={() => void withdraw()}
          >
            {busy ? t("working") : t("withdraw")}
          </button>
        </div>
      </div>
    </section>
  );
}
