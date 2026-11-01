"use client";

/**
 * Send market calls from the connected wallet (one transaction per call, confirmed in the wallet, gas paid in USDC),
 * then nudge the Convex indexer so the page shows the result in seconds instead of on the next cron tick.
 */
import { useCallback, useState } from "react";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { ArcCall, ArcSession, CallsReceipt } from "@/lib/arc/session";

function describe(err: unknown): string {
  const e = err as { code?: number; message?: string; shortMessage?: string };
  if (e?.code === 4001 || /User rejected|rejected the request|denied/i.test(e?.message ?? "")) return "The transaction was cancelled in your wallet.";
  const msg = e?.shortMessage ?? e?.message ?? "Something went wrong.";
  // The contracts' own words, when the revert reason made it through.
  if (/PoolFull/.test(msg)) return "This market is full: challengers can stake at most 5× the creator's stake.";
  if (/BettingClosed|challenge window closed/.test(msg)) return "Staking has closed on this market.";
  if (/already challenged/.test(msg)) return "You already challenged this market.";
  if (/insufficient funds/i.test(msg)) return "Not enough USDC on Arc for this and its gas.";
  return msg;
}

export function useArcSend(session: ArcSession | null) {
  const poke = useMutation(api.arc.poke);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<CallsReceipt | null>(null);

  const send = useCallback(
    async (calls: ArcCall[]): Promise<CallsReceipt | null> => {
      if (!session) return null;
      setBusy(true);
      setError(null);
      try {
        const r = await session.sendCalls(calls);
        setLast(r);
        // A short tap on phones that support it: the stake landed.
        navigator.vibrate?.(18);
        void poke({}).catch(() => {});
        return r;
      } catch (err) {
        setError(describe(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [session, poke],
  );

  return { send, busy, error, last, clearError: () => setError(null) };
}
