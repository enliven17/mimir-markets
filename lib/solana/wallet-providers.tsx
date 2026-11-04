"use client";
import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { SOLANA_RPC } from "./config";
import { devnetConnectionConfig } from "./devnet-connection";
import { emitWalletError } from "./wallet-events";

/** Wallet Standard discovers installed wallets and the Android mobile adapter. */
export default function SolanaWalletProviders({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [], []);
  const config = useMemo(() => devnetConnectionConfig(SOLANA_RPC), []);
  return <ConnectionProvider endpoint={SOLANA_RPC} config={config}>
    <WalletProvider wallets={wallets} autoConnect onError={emitWalletError}>{children}</WalletProvider>
  </ConnectionProvider>;
}
export function requestWalletConnect() { /* Wallet Standard owns discovery. */ }
