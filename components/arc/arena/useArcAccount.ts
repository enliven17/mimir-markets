"use client";

/**
 * The connected wallet as a market account on one chain (Base by default, the primary network): the session that
 * sends market calls from it, its USDC there in index units (18 dp, lib/chains/amounts.ts; null = not known yet), its
 * gas token balance (ETH on Base; on Arc gas is the same USDC), and its entry fee as that chain's MimirFees has it
 * (0.5% by default). `sendAction` runs lib/chains/send.ts: Base approve/permit handling, the no-ETH check.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useMimirWallet } from "@/hooks/useMimirWallet";
import { useWallet } from "@solana/wallet-adapter-react";
import { createBrowserMimir, getVirtualBalance } from "@/lib/solana/browser-client";
import { sendSolanaMarketAction, INDEX_SCALE } from "@/lib/solana/market-adapter";
import type { MarketAction } from "@/lib/chains/calls";
import { gasBalanceWei, usdcBalanceWei } from "@/lib/chains/client";
import { MARKET_CHAINS, marketChain, type MarketChainId } from "@/lib/chains/registry";

export function useArcAccount(chain: MarketChainId = MARKET_CHAINS.defaultChain) {
  const wallet = useMimirWallet();
  const nativeWallet = useWallet();
  const address = wallet.address;
  const cfg = marketChain(chain);
  const session = useMemo(() => address && cfg.enabled && chain === "solana" ? createBrowserMimir(nativeWallet) : null, [address, nativeWallet, cfg, chain]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [programBalance, setProgramBalance] = useState<bigint | null>(null);
  const [gas, setGas] = useState<bigint | null>(null);
  const [onchainBps, setOnchainBps] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!address || !cfg.enabled) {
      setBalance(null);
      setProgramBalance(null);
      setGas(null);
      setOnchainBps(null);
      return;
    }
    const [held, free, gasWei] = await Promise.all([
      usdcBalanceWei(cfg, address).catch(() => null),
      session ? getVirtualBalance(session).then((n) => n * INDEX_SCALE).catch(() => null) : Promise.resolve(0n),
      gasBalanceWei(cfg, address).catch(() => null),
    ]);
    // A failed read stays unknown rather than zero.
    setBalance(held === null || free === null ? null : held + free);
    setProgramBalance(free);
    setGas(gasWei);
    setOnchainBps(0);
  }, [address, cfg, session]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const entryBps = 0;

  /** One market action from the wallet on this chain (approve or permit on Base as needed). */
  const sendAction = useCallback(
    async (action: MarketAction) => {
      if (!session || !address) throw new Error("Connect your wallet first.");
      return sendSolanaMarketAction(session, action);
    },
    [session, address, cfg, chain],
  );

  return { wallet, chain, chainConfig: cfg, session, address, balance, programBalance, gas, reload, entryBps, sendAction };
}
