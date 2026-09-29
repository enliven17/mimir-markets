"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { txErrorMessage } from "@/lib/tx-errors";

/** Unix seconds, re-read every `intervalMs` so countdowns tick. */
export function useNowSec(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * One wallet action at a time: `busy` names the running one, a success toasts
 * and refreshes the claim, a failure toasts the readable reason.
 */
export function useSettleAction(onDone?: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, success: string, fn: () => Promise<unknown>) => {
      setBusy(key);
      try {
        await fn();
        toast.success(success);
        onDone?.();
      } catch (err) {
        toast.error(txErrorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [onDone]
  );
  return { busy, run };
}

export function shortKey(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
