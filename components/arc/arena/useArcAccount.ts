"use client";

/**
 * The passkey session (restored silently, like /wallet) and its USDC on Arc
 * in wei, for the stake and create forms. Null balance = not known yet.
 */
import { useCallback, useEffect, useState } from "react";

import { arcUsdcUnits } from "@/lib/arc/chain";
import { useArcWallet } from "../useArcWallet";

export function useArcAccount() {
  const wallet = useArcWallet();
  const address = wallet.session?.address ?? null;
  const [balance, setBalance] = useState<bigint | null>(null);

  const reload = useCallback(async () => {
    if (!address) return setBalance(null);
    // 6-dp units → wei; a failed read stays unknown rather than zero.
    setBalance(await arcUsdcUnits(address).then((u) => u * 1_000_000_000_000n).catch(() => null));
  }, [address]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  return { wallet, session: wallet.session, address, balance, reload };
}
