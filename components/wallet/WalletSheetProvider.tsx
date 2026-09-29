"use client";

/**
 * Opens and closes the connect sheet from anywhere (header chip, page gates,
 * the onboarding checklist). Replaces wallet-adapter-react-ui's
 * `useWalletModal`. Mounted inside the i18n provider (app/[locale]/layout),
 * so the sheet and wallet error toasts are translated.
 *
 * Wallet errors raised while the sheet is closed (autoConnect on load, a
 * wallet that dropped) become a toast; while it is open the sheet shows them
 * on the wallet row instead.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { isUserRejection, onWalletError } from "@/lib/solana/wallet-events";
import ConnectSheet from "./ConnectSheet";

interface WalletSheetContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const WalletSheetContext = createContext<WalletSheetContextValue | null>(null);

export function useWalletSheet(): WalletSheetContextValue {
  const ctx = useContext(WalletSheetContext);
  if (!ctx) throw new Error("useWalletSheet must be used inside WalletSheetProvider");
  return ctx;
}

export default function WalletSheetProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("wallet");
  const [isOpen, setIsOpen] = useState(false);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(
    () =>
      onWalletError((error, adapter) => {
        if (openRef.current) return; // the sheet renders it on the row
        if (isUserRejection(error)) return;
        console.error("Wallet error:", error);
        toast.error(t("toastError", { wallet: adapter?.name ?? t("genericWallet") }));
      }),
    [t],
  );

  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);

  return (
    <WalletSheetContext.Provider value={value}>
      {children}
      <ConnectSheet open={isOpen} onClose={close} />
    </WalletSheetContext.Provider>
  );
}
