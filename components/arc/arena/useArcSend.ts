"use client";

/**
 * Send market calls from the passkey account (one sponsored user operation,
 * the browser's passkey prompt), then nudge the Convex indexer so the page
 * shows the result in seconds instead of on the next cron tick.
 */
import { useCallback, useState } from "react";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { ArcSession, CallsReceipt } from "@/lib/arc/account";
import type { ArcCall } from "@/lib/arc/cctp-arc";

function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; shortMessage?: string; cause?: { name?: string } };
  if (e?.name === "NotAllowedError" || e?.cause?.name === "NotAllowedError") return "The passkey prompt was closed or timed out.";
  const msg = e?.shortMessage ?? e?.message ?? "Something went wrong.";
  // The contracts' own words, when the revert reason made it through.
  if (/PoolFull/.test(msg)) return "This market is full: challengers can stake at most 5× the creator's stake.";
  if (/BettingClosed|challenge window closed/.test(msg)) return "Betting has closed on this market.";
  if (/already challenged/.test(msg)) return "You already challenged this market.";
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
