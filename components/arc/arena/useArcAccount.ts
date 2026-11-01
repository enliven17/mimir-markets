"use client";

/**
 * The connected wallet as a market account on Arc: the session that sends market calls from it (each a transaction,
 * gas paid in USDC), its USDC on Arc in wei (null = not known yet), and its entry fee as MimirFees has it on chain
 * (0.5% by default).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useMimirWallet } from "@/hooks/useMimirWallet";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { ENTRY_FEE_BPS } from "@/lib/arc/fees";
import { MIMIR_FEES_ABI } from "@/lib/arc/markets";
import { arcSessionFor } from "../useEvmWallet";

export function useArcAccount() {
  const wallet = useMimirWallet();
  const address = wallet.address;
  const session = useMemo(() => (address ? arcSessionFor(address) : null), [address]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [onchainBps, setOnchainBps] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!address) {
      setBalance(null);
      setOnchainBps(null);
      return;
    }
    const fees = ARC.contracts.mimirFees;
    const client = arcPublicClient();
    const [wei, bps] = await Promise.all([
      client.getBalance({ address }).catch(() => null),
      fees
        ? client
            .readContract({ address: fees, abi: MIMIR_FEES_ABI, functionName: "entryBps", args: [address] })
            .then(Number)
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    // A failed read stays unknown rather than zero.
    setBalance(wei);
    setOnchainBps(bps);
  }, [address]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const entryBps = onchainBps ?? ENTRY_FEE_BPS;

  return { wallet, session, address, balance, reload, entryBps };
}
