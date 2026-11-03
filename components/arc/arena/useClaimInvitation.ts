"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { readClaimInvitation } from "@/lib/chains/invites";
import { chainPublicClient } from "@/lib/chains/client";
import type { MarketChain } from "@/lib/chains/registry";

/** Live, fail-closed permissions. A stale read can never describe a different wallet/claim/chain. */
export function useClaimInvitation(cfg: MarketChain, marketId: number, wallet: Address | null, enabled: boolean) {
  const contract = cfg.contracts.mimirV3;
  const key = enabled && contract && wallet ? `${cfg.id}:${cfg.chainId}:${contract.toLowerCase()}:${marketId}:${wallet.toLowerCase()}` : null;
  const current = useRef(key);
  current.current = key;
  const sequence = useRef(0);
  const [state, setState] = useState<{ key: string; allowed: boolean | null; error: boolean } | null>(null);

  const checkNow = useCallback(async (): Promise<boolean> => {
    if (!key || !contract || !wallet || current.current !== key) return false;
    const request = ++sequence.current;
    setState({ key, allowed: null, error: false });
    try {
      const allowed = await readClaimInvitation(chainPublicClient(cfg), contract, marketId, wallet);
      if (current.current !== key || sequence.current !== request) return false;
      setState({ key, allowed, error: false });
      return allowed;
    } catch {
      if (current.current === key && sequence.current === request) setState({ key, allowed: null, error: true });
      return false;
    }
  }, [key, contract, wallet, cfg, marketId]);

  useEffect(() => {
    if (!key) return;
    void checkNow();
    const refresh = () => { void checkNow(); };
    const timer = setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => { ++sequence.current; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [key, checkNow]);

  const live = key && state?.key === key ? state : null;
  return { allowed: live?.allowed ?? null, checked: live?.allowed !== undefined && live?.allowed !== null, error: live?.error ?? false, checkNow };
}
