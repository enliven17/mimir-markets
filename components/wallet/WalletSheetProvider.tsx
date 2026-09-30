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

import dynamic from "next/dynamic";
import { isUserRejection, onWalletError } from "@/lib/solana/wallet-events";
import { requestWalletConnect } from "@/lib/solana/wallet-providers";

// The sheet is code-split and only mounted once it has been opened: nothing
// of it is parsed or rendered on a plain page view.
const ConnectSheet = dynamic(() => import("./ConnectSheet"), { ssr: false });

interface WalletSheetContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Start loading the sheet ahead of a click (hover, focus). */
  warm: () => void;
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
  const [everOpened, setEverOpened] = useState(false);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  const open = useCallback(() => {
    setEverOpened(true);
    setIsOpen(true);
    // WalletConnect (over 1MB) evaluates after the sheet's entrance, never
    // in the same frames; its row appears when it is ready.
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(requestWalletConnect, { timeout: 400 });
    else window.setTimeout(requestWalletConnect, 250);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  // Hover or focus only fetches the small sheet chunk. Warming WalletConnect
  // here evaluated it whenever a scroll carried a connect button under the
  // pointer: a long task in the middle of scrolling.
  const warm = useCallback(() => {
    void import("./ConnectSheet");
  }, []);

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

  const value = useMemo(() => ({ isOpen, open, close, warm }), [isOpen, open, close, warm]);

  return (
    <WalletSheetContext.Provider value={value}>
      {children}
      {everOpened ? <ConnectSheet open={isOpen} onClose={close} /> : null}
    </WalletSheetContext.Provider>
  );
}
