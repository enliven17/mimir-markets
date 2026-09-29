"use client";

/**
 * Solana wallet context (app-wide, from the root layout).
 *
 * Wallets come from two places:
 * - Wallet Standard: installed wallets (Phantom, Solflare, Backpack, …)
 *   register themselves and the adapter discovers them automatically.
 * - Explicit Phantom + Solflare adapters, so the modal still lists them when
 *   no extension is installed. Clicking one opens its install page on desktop
 *   and the in-wallet browser deep link on iOS; the adapter drops these when
 *   the same wallet also registers through the Wallet Standard.
 * - WalletConnect (mobile QR), only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 *   is set. It is imported lazily because it pulls Reown AppKit.
 *
 * We deliberately avoid `@solana/wallet-adapter-wallets`: it pulls the Ledger
 * adapter's `usb` native module, which needs a C/Python toolchain to build
 * and breaks clean container installs.
 */
import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletAdapterNetwork, type Adapter } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { SOLANA_RPC } from "./config";

import "@solana/wallet-adapter-react-ui/styles.css";

const NETWORK = WalletAdapterNetwork.Devnet;
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/** Lazily build the WalletConnect adapter when a project id is configured. */
function useWalletConnectAdapter(): Adapter | null {
  const [adapter, setAdapter] = useState<Adapter | null>(null);

  useEffect(() => {
    if (!WALLETCONNECT_PROJECT_ID) return;
    let cancelled = false;
    import("@solana/wallet-adapter-walletconnect")
      .then(({ WalletConnectWalletAdapter }) => {
        if (cancelled) return;
        setAdapter(
          new WalletConnectWalletAdapter({
            network: NETWORK,
            options: {
              projectId: WALLETCONNECT_PROJECT_ID,
              metadata: {
                name: "Mimir",
                description: "AI-settled claim markets on Solana",
                url: window.location.origin,
                icons: [`${window.location.origin}/icon.svg`],
              },
            },
          }),
        );
      })
      .catch((error) => {
        console.error("WalletConnect adapter failed to load:", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return adapter;
}

export function SolanaWalletProviders({ children }: { children: ReactNode }) {
  const walletConnect = useWalletConnectAdapter();
  const wallets = useMemo<Adapter[]>(() => {
    const base: Adapter[] = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: NETWORK }),
    ];
    return walletConnect ? [...base, walletConnect] : base;
  }, [walletConnect]);

  return (
    <ConnectionProvider endpoint={SOLANA_RPC} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
