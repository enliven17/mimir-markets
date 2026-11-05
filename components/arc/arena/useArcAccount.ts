"use client";

/**
 * The connected wallet as a market account on one chain (Base by default, the primary network): the session that
 * sends market calls from it, its USDC there in index units (18 dp, lib/chains/amounts.ts; null = not known yet), its
 * gas token balance (ETH on Base; on Arc gas is the same USDC), and its entry fee as that chain's MimirFees has it
 * (0.5% by default). `sendAction` runs lib/chains/send.ts: Base approve/permit handling, the no-ETH check.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";

import { useMimirWallet } from "@/hooks/useMimirWallet";
import { ENTRY_FEE_BPS } from "@/lib/arc/fees";
import { MIMIR_FEES_ABI } from "@/lib/arc/markets";
import type { MarketAction } from "@/lib/chains/calls";
import { chainPublicClient, ERC20_ABI, gasBalanceWei, usdcAllowanceWei, usdcBalanceWei } from "@/lib/chains/client";
import { MARKET_CHAINS, marketChain, type MarketChainId } from "@/lib/chains/registry";
import { sendMarketAction } from "@/lib/chains/send";
import { marketSessionFor, signTypedDataWithEvm } from "../useEvmWallet";

/** USDC's EIP-712 name/version and the owner's permit nonce, read from the token (FiatToken v2). */
async function permitInfo(chain: MarketChainId, owner: Address) {
  const c = marketChain(chain);
  const client = chainPublicClient(c);
  const [nonce, name, version] = await Promise.all([
    client.readContract({ address: c.usdc.address, abi: ERC20_ABI, functionName: "nonces", args: [owner] }),
    client.readContract({ address: c.usdc.address, abi: ERC20_ABI, functionName: "name" }),
    client.readContract({ address: c.usdc.address, abi: ERC20_ABI, functionName: "version" }).catch(() => "2"),
  ]);
  return { nonce, name, version };
}

export function useArcAccount(chain: MarketChainId = MARKET_CHAINS.defaultChain) {
  const wallet = useMimirWallet();
  const address = wallet.address;
  const cfg = marketChain(chain);
  const session = useMemo(() => (address && cfg.enabled ? marketSessionFor(chain, address) : null), [address, chain, cfg]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [gas, setGas] = useState<bigint | null>(null);
  const [onchainBps, setOnchainBps] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!address || !cfg.enabled) {
      setBalance(null);
      setGas(null);
      setOnchainBps(null);
      return;
    }
    const fees = cfg.contracts.mimirFees;
    const client = chainPublicClient(cfg);
    const [wei, gasWei, bps] = await Promise.all([
      usdcBalanceWei(cfg, address, client).catch(() => null),
      cfg.gas.symbol === "ETH" ? gasBalanceWei(cfg, address, client).catch(() => null) : Promise.resolve(null),
      fees
        ? client
            .readContract({ address: fees, abi: MIMIR_FEES_ABI, functionName: "entryBps", args: [address] })
            .then(Number)
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    // A failed read stays unknown rather than zero.
    setBalance(wei);
    setGas(gasWei);
    setOnchainBps(bps);
  }, [address, cfg]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const entryBps = onchainBps ?? ENTRY_FEE_BPS;

  /** One market action from the wallet on this chain (approve or permit on Base as needed). */
  const sendAction = useCallback(
    async (action: MarketAction) => {
      if (!session || !address) throw new Error("Connect your wallet first.");
      return sendMarketAction(cfg, session, action, {
        allowance: (owner, spender) => usdcAllowanceWei(cfg, owner, spender),
        gasBalance: cfg.gas.symbol === "ETH" ? (owner) => gasBalanceWei(cfg, owner) : undefined,
        permitInfo: (owner) => permitInfo(chain, owner),
        signTypedData: (typed) => signTypedDataWithEvm(chain, address, typed as never),
        simulate: async ({ from, to, data }) => { await chainPublicClient(cfg).call({ account: from, to, data }); },
      });
    },
    [session, address, cfg, chain],
  );

  return { wallet, chain, chainConfig: cfg, session, address, balance, gas, reload, entryBps, sendAction };
}
