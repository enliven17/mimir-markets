"use client";

/**
 * Solana wallet context (app-wide, from the root layout).
 *
 * Wallets come from the Wallet Standard only: Phantom, Solflare, Backpack and
 * every other standard wallet register themselves and the adapter discovers
 * them. On Android the provider adds the Solana Mobile Wallet Adapter by
 * itself. Wallets that are not installed, and the iOS "open in wallet" deep
 * links, are handled by our own connect sheet (components/wallet).
 *
 * WalletConnect (mobile QR) is added only when
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set. It is imported lazily because
 * it pulls Reown AppKit.
 *
 * We deliberately avoid `@solana/wallet-adapter-wallets`: it pulls the Ledger
 * adapter's `usb` native module, which needs a C/Python toolchain to build
 * and breaks clean container installs.
 */
import { ReactNode, useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork, type Adapter, type WalletError } from "@solana/wallet-adapter-base";
import { SOLANA_RPC } from "./config";
import { emitWalletError } from "./wallet-events";

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

const onError = (error: WalletError, adapter?: Adapter) => emitWalletError(error, adapter);

export function SolanaWalletProviders({ children }: { children: ReactNode }) {
  const walletConnect = useWalletConnectAdapter();
  const wallets = useMemo<Adapter[]>(() => (walletConnect ? [walletConnect] : []), [walletConnect]);

  return (
    <ConnectionProvider endpoint={SOLANA_RPC} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
