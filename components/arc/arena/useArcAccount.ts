"use client";

/**
 * The passkey session (restored silently, like /wallet), its USDC on Arc in
 * wei, and its entry fee: the $MIMIR holder ticket from /api/arc/fee-ticket
 * and what MimirFees already has on chain for the account. When the ticket
 * beats the on-chain rate, `withTicket` puts applyTicket in front of the bet,
 * in the same passkey prompt. Null balance = not known yet.
 */
import { useCallback, useEffect, useState } from "react";

import { arcPublicClient, arcUsdcUnits } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import type { ArcCall } from "@/lib/arc/cctp-arc";
import { ENTRY_FEE_BPS, type FeeTicket } from "@/lib/arc/fee-tiers";
import { applyTicketCall, MIMIR_FEES_ABI } from "@/lib/arc/markets";
import { useArcWallet } from "../useArcWallet";

export function useArcAccount() {
  const wallet = useArcWallet();
  const address = wallet.session?.address ?? null;
  const [balance, setBalance] = useState<bigint | null>(null);
  const [ticket, setTicket] = useState<FeeTicket | null>(null);
  const [onchainBps, setOnchainBps] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!address) {
      setBalance(null);
      setOnchainBps(null);
      return;
    }
    const fees = ARC.contracts.mimirFees;
    const [units, bps] = await Promise.all([
      arcUsdcUnits(address).catch(() => null),
      fees
        ? arcPublicClient()
            .readContract({ address: fees, abi: MIMIR_FEES_ABI, functionName: "entryBps", args: [address] })
            .then(Number)
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    // 6-dp units → wei; a failed read stays unknown rather than zero.
    setBalance(units === null ? null : units * 1_000_000_000_000n);
    setOnchainBps(bps);
  }, [address]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  // The ticket: once per account and page view (it is good for 24 h).
  useEffect(() => {
    setTicket(null);
    if (!address) return;
    let cancelled = false;
    fetch(`/api/arc/fee-ticket?account=${address}`)
      .then((r) => (r.ok ? (r.json() as Promise<FeeTicket>) : null))
      .then((t) => !cancelled && setTicket(t))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address]);

  const ticketBps = ticket?.signature ? ENTRY_FEE_BPS[ticket.tier] : null;
  const needsTicket = ticketBps !== null && (onchainBps === null || ticketBps < onchainBps);
  // The rate this bet pays: the ticket's when it will be applied, else what the chain has (0.5% by default).
  const entryBps = needsTicket ? ticketBps! : (onchainBps ?? ENTRY_FEE_BPS[0]);
  const tier = needsTicket || (ticket && onchainBps === ticketBps) ? (ticket?.tier ?? 0) : 0;

  const withTicket = useCallback(
    (calls: ArcCall[]): ArcCall[] => {
      const fees = ARC.contracts.mimirFees;
      const apply = needsTicket && fees && ticket ? applyTicketCall(fees, ticket) : null;
      return apply ? [apply, ...calls] : calls;
    },
    [needsTicket, ticket],
  );

  return { wallet, session: wallet.session, address, balance, reload, entryBps, tier, withTicket };
}
