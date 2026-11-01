"use client";

/**
 * Opens and closes the connect sheet from anywhere (header chip, page gates). Mounted inside the i18n provider
 * (app/[locale]/layout), so the sheet is translated. The sheet picks the network (Arc or Base) and hands over to
 * ConnectKit.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import dynamic from "next/dynamic";

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
  const [isOpen, setIsOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const open = useCallback(() => {
    setEverOpened(true);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  // Hover or focus only fetches the small sheet chunk.
  const warm = useCallback(() => {
    void import("./ConnectSheet");
  }, []);


  const value = useMemo(() => ({ isOpen, open, close, warm }), [isOpen, open, close, warm]);

  return (
    <WalletSheetContext.Provider value={value}>
      {children}
      {everOpened ? <ConnectSheet open={isOpen} onClose={close} /> : null}
    </WalletSheetContext.Provider>
  );
}
