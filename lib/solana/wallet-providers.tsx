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
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set, and only on demand: it pulls
 * Reown AppKit (over 1MB of script), so it loads when the connect sheet opens
 * or the wallet chip is hovered or focused (`requestWalletConnect`), or at
 * startup when WalletConnect is the wallet autoConnect will restore. Never on
 * a plain page view.
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

// wallet-adapter-react's default autoConnect key (a JSON string).
const WALLET_NAME_KEY = "walletName";

let wcWanted = false;
const wcListeners = new Set<() => void>();

/** Ask for the WalletConnect adapter (sheet open, chip hover). Idempotent. */
export function requestWalletConnect(): void {
  if (!WALLETCONNECT_PROJECT_ID || wcWanted) return;
  wcWanted = true;
  wcListeners.forEach((fn) => fn());
}

function restoresWalletConnect(): boolean {
  try {
    return JSON.parse(localStorage.getItem(WALLET_NAME_KEY) ?? "null") === "WalletConnect";
  } catch {
    return false;
  }
}

/** Build the WalletConnect adapter once something asks for it. */
function useWalletConnectAdapter(): Adapter | null {
  const [adapter, setAdapter] = useState<Adapter | null>(null);
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    if (!WALLETCONNECT_PROJECT_ID) return;
    if (restoresWalletConnect()) requestWalletConnect();
    const onWant = () => setWanted(true);
    if (wcWanted) onWant();
    wcListeners.add(onWant);
    return () => {
      wcListeners.delete(onWant);
    };
  }, []);

  useEffect(() => {
    if (!WALLETCONNECT_PROJECT_ID || !wanted) return;
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
  }, [wanted]);

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
