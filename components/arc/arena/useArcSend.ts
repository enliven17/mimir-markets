"use client";

/**
 * Send market actions from the connected wallet on the account's chain (lib/chains/send.ts: Arc one tx with the USDC
 * as value; Base a permit signature then one tx, or approve + call), then nudge that chain's Convex indexer so the
 * page shows the result in seconds instead of on the next cron tick.
 */
import { useCallback, useState } from "react";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { SolanaReceipt as CallsReceipt } from "@/lib/solana/market-adapter";
import type { MarketAction } from "@/lib/chains/calls";
import type { MarketChain } from "@/lib/chains/registry";
import { NoGasError } from "@/lib/chains/send";
import type { useArcAccount } from "./useArcAccount";

export function describeSendError(err: unknown, chain: Pick<MarketChain, "label" | "gas">): string {
  if (err instanceof NoGasError) return err.message;
  const e = err as { code?: number; message?: string; shortMessage?: string };
  if (e?.code === 4001 || /User rejected|rejected the request|denied/i.test(e?.message ?? "")) return "The transaction was cancelled in your wallet.";
  const msg = e?.shortMessage ?? e?.message ?? "Something went wrong.";
  // The contracts' own words, when the revert reason made it through.
  if (/PoolFull/.test(msg)) return "This market is full: challengers can stake at most 5× the creator's stake.";
  if (/BettingClosed|challenge window closed/.test(msg)) return "Staking has closed on this market.";
  if (/already challenged/.test(msg)) return "You already challenged this market.";
  if (/transfer amount exceeds (balance|allowance)|ERC20: insufficient/i.test(msg)) return `Not enough USDC on ${chain.label} for this.`;
  if (/insufficient funds/i.test(msg))
    return chain.gas.symbol === "SOL" ? "Not enough devnet SOL to pay network fees." : chain.gas.symbol === "ETH" ? `Not enough ETH on ${chain.label} to pay the gas.` : `Not enough USDC on ${chain.label} for this and its gas.`;
  if (/SubUnit|whole number of them/.test(msg)) return "USDC has 6 decimals: use at most 6 digits after the point.";
  return msg;
}

export function useArcSend(account: ReturnType<typeof useArcAccount>) {
  const poke = useMutation(api.arc.poke);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<CallsReceipt | null>(null);
  const { sendAction, chain, chainConfig, session } = account;

  const send = useCallback(
    async (action: MarketAction): Promise<CallsReceipt | null> => {
      if (!session) return null;
      setBusy(true);
      setError(null);
      try {
        const r = await sendAction(action);
        setLast(r);
        // A short tap on phones that support it: the stake landed.
        navigator.vibrate?.(18);
        void poke({ chain }).catch(() => {});
        return r;
      } catch (err) {
        setError(describeSendError(err, chainConfig));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [session, sendAction, poke, chain, chainConfig],
  );

  return { send, busy, error, last, clearError: () => setError(null) };
}
