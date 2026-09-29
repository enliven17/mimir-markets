import type { Adapter, WalletError } from "@solana/wallet-adapter-base";

/**
 * Wallet errors raised by the adapter provider (connect, autoConnect, sign),
 * handed to the UI that owns wallet messaging (components/wallet). The
 * provider lives in the root layout, outside the i18n provider, so it cannot
 * render or translate anything itself.
 */
export type WalletErrorListener = (error: WalletError, adapter?: Adapter) => void;

const listeners = new Set<WalletErrorListener>();

export function onWalletError(listener: WalletErrorListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWalletError(error: WalletError, adapter?: Adapter): void {
  if (listeners.size === 0) {
    console.error("Wallet error:", error);
    return;
  }
  listeners.forEach((listener) => listener(error, adapter));
}

/** A user closing or refusing the wallet prompt, not a failure. */
export function isUserRejection(error: unknown): boolean {
  const e = error as { message?: string; name?: string; error?: { code?: number; message?: string } } | null;
  if (!e) return false;
  if (e.error?.code === 4001) return true;
  const text = `${e.name ?? ""} ${e.message ?? ""} ${e.error?.message ?? ""}`;
  return /reject|denied|declined|cancel/i.test(text);
}
