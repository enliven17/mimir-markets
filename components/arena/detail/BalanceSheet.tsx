"use client";

/** "Manage balance" from the action dock: the rollup balance, deposit and delegate, withdraw. */
import { useTranslations } from "next-intl";
import Modal from "@/components/ui/Modal";
import BalanceCard from "@/components/arena/settlement/BalanceCard";
import { useWalletFunds } from "@/hooks/useWalletFunds";
import type { BrowserMimir } from "@/lib/solana/browser-client";

export default function BalanceSheet({
  open,
  onClose,
  mimir,
  balance,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  mimir: BrowserMimir | null;
  balance: bigint;
  onChanged: () => void;
}) {
  const t = useTranslations("arena.detail.balanceSheet");
  return (
    <Modal open={open} onClose={onClose} title={t("title")} variant="sheet">
      {open ? <SheetBody mimir={mimir} balance={balance} onChanged={onChanged} /> : null}
    </Modal>
  );
}

/** Reads the wallet's USDC only while the sheet is open. */
function SheetBody({ mimir, balance, onChanged }: { mimir: BrowserMimir | null; balance: bigint; onChanged: () => void }) {
  const funds = useWalletFunds();
  return (
    <BalanceCard
      mimir={mimir}
      balance={balance}
      walletUsdc={funds.usdcUnits}
      onChanged={() => {
        onChanged();
        void funds.reload();
      }}
    />
  );
}
