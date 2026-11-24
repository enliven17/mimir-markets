"use client";

import { useState } from "react";
import type { MarketChain } from "@/lib/chains/registry";

/** Funding help stays beside the action that needs funds. */
export default function WalletFunding({ chain, address }: { chain: MarketChain; address: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid min-w-0 gap-2 text-[13px] leading-relaxed text-muted">
      <p className="m-0">Send USDC on {chain.name} to your connected wallet{chain.gas.symbol !== "USDC" ? `, plus a little ${chain.gas.symbol} on the same network for gas` : ""}.</p>
      {address ? <button type="button" className="break-all text-left font-mono text-coral hover:underline" onClick={async () => {
        try { await navigator.clipboard.writeText(address); setCopied(true); } catch { setCopied(false); }
      }}>{copied ? "Address copied" : `Copy address: ${address}`}</button> : null}
      {chain.network === "testnet" ? (
        chain.id === "bsc" ? (
          <a href="https://www.bnbchain.org/en/testnet-faucet" target="_blank" rel="noreferrer" className="text-coral hover:underline">Get test BNB / USDC from BNB Chain Testnet Faucet</a>
        ) : (
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-coral hover:underline">Get test USDC from Circle’s faucet (select {chain.name})</a>
        )
      ) : null}
    </div>
  );
}
