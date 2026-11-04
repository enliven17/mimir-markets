"use client";
import { useCallback } from "react";
import { useConnection, useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import bs58 from "bs58";
export { WalletReadyState };
export type { WalletName };
export type MimirWalletOption = Wallet;
export function isReady(w: Wallet) { return w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable; }
export function useMimirWallet() {
  const w = useWallet();
  const { connection } = useConnection();
  const sign = useCallback(async (message: string) => {
    if (!w.signMessage) throw new Error("This wallet does not support message signing.");
    return bs58.encode(await w.signMessage(new TextEncoder().encode(message)));
  }, [w.signMessage]);
  return { ...w, connection, address: w.publicKey?.toBase58() ?? null, intent: "solana" as const,
    networkName: "Solana Devnet", signMessage: w.publicKey && w.signMessage ? sign : null };
}
export function useMimirConnection() { return useConnection(); }
