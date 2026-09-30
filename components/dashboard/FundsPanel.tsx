"use client";

/**
 * The portfolio's balance sheet, opened by Deposit or Withdraw: the Mimir
 * virtual balance and wallet USDC, a deposit-and-delegate top-up and a
 * withdraw of the whole free balance (undelegating first when needed; never
 * paused). Mounts its body only while open.
 */
import { useTranslations } from "next-intl";

import BalanceCard from "@/components/arena/settlement/BalanceCard";
import { Modal, Skeleton } from "@/components/ui";
import type { WalletFunds } from "@/hooks/useWalletFunds";
import type { BrowserMimir } from "@/lib/solana/browser-client";

export type FundsAction = "deposit" | "withdraw";

export default function FundsPanel({
  open,
  action,
  onClose,
  funds,
  mimir,
  onChanged,
}: {
  open: boolean;
  action: FundsAction;
  onClose: () => void;
  funds: WalletFunds;
  mimir: BrowserMimir | null;
  onChanged: () => void;
}) {
  const t = useTranslations("dashboard");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("fundsSheet")}
      variant="sheet"
      initialFocus={action === "withdraw" ? '[data-action="withdraw"]' : "input"}
    >
      {!open ? null : mimir ? (
        <BalanceCard mimir={mimir} balance={funds.virtualUnits ?? 0n} walletUsdc={funds.usdcUnits} onChanged={onChanged} />
      ) : (
        <div role="status" aria-label={t("fundsLoading")} className="grid gap-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      )}
    </Modal>
  );
}
