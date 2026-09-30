"use client";

/**
 * Drop-in for the old `WalletMultiButton` on page gates: a primary pill that
 * opens the connect sheet while disconnected, the wallet chip once connected.
 */
import { useTranslations } from "next-intl";
import { Wallet } from "lucide-react";

import Button from "@/components/ui/Button";
import { useMimirWallet } from "@/hooks/useMimirWallet";
import { useWalletSheet } from "./WalletSheetProvider";
import WalletChip from "./WalletChip";

export default function ConnectWalletButton({ className = "" }: { className?: string }) {
  const t = useTranslations("wallet");
  const { connected, connecting } = useMimirWallet();
  const { open, warm } = useWalletSheet();
  if (connected) return <WalletChip className={className} />;
  return (
    <Button size="sm" fullWidth={false} loading={connecting} onClick={open} onPointerEnter={warm} onFocus={warm} className={className}>
      {!connecting ? <Wallet size={16} aria-hidden /> : null}
      {connecting ? t("connecting") : t("connectWallet")}
    </Button>
  );
}
