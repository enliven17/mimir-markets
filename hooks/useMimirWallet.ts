"use client";

/**
 * The one place the UI shell touches the wallet kit. Today it is a thin facade over `@solana/wallet-adapter-react`; a
 * future switch (ConnectorKit, AppKit) rewrites this file and the shell
 * (components/wallet) keeps compiling. Existing feature code still calls
 * `useWallet` / `useConnection` directly; that is fine, the hooks are the
 * same objects.
 */
import { useConnection, useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";

export type MimirWalletOption = Wallet;
export { WalletReadyState };
export type { WalletName };

export function useMimirWallet() {
  const wallet = useWallet();
  const { connection } = useConnection();
  return { ...wallet, connection };
}

export function useMimirConnection() {
  return useConnection();
}

/** Wallet Standard wallets that can connect right now (installed or loadable). */
export function isReady(option: MimirWalletOption): boolean {
  return option.readyState === WalletReadyState.Installed || option.readyState === WalletReadyState.Loadable;
}
