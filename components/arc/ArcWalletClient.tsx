"use client";

/**
 * /wallet body: the connected EVM wallet is the Mimir account. Connect it (one address on Base and Arc), see its USDC
 * on every enabled market chain and how to add more. Every market action is a transaction from this wallet: on Base the
 * stake is USDC and gas is ETH; on Arc both are USDC. Mimir never holds a key.
 */
import { useState } from "react";

import { SURFACE } from "@/components/arena/surface";
import { ExternalMark } from "@/components/ExternalMark";
import Skeleton from "@/components/ui/Skeleton";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { explorerUrl, MARKET_CHAINS, type MarketChainId } from "@/lib/chains/registry";
import { ChainBadge } from "./NetworkLogos";
const CIRCLE_FAUCET_URL = "https://faucet.circle.com";
import { useArcAccount } from "./arena/useArcAccount";
import { usd } from "./arena/shared";

const BTN_SECONDARY = "press rounded-full bg-panel-raised px-5 py-2.5 text-[14px] text-cream disabled:opacity-60";

export default function ArcWalletClient() {
  const account = useArcAccount();
  const { wallet, address } = account;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked: the address is still on the page */
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="grid gap-2">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">
          Markets on {MARKET_CHAINS.enabled.map((c) => MARKET_CHAINS.chains[c].name).join(" and ") || "Base"}
        </p>
        <h1 className="m-0 font-display text-app-h1 text-cream">Your wallet.</h1>
        <p className="m-0 max-w-[62ch] text-[15px] leading-relaxed text-muted">
          Connect an EVM wallet (the same address on Base and Arc). That address is your Mimir account: you stake, dispute and get paid
          straight from it. On Base you need USDC and a little ETH for gas; on Arc, gas is paid in USDC. Mimir never holds a key.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The wallet chip's menu opens below the button: let it out of the card instead of clipping it. */}
        <section aria-labelledby="wallet-step-1" className={`${SURFACE} !overflow-visible z-10 grid content-start gap-3 p-5 sm:p-6`}>
          <h2 id="wallet-step-1" className="m-0 text-[1.2rem] leading-none text-cream">
            1. {wallet.networkName ? `${wallet.networkName} wallet` : "Wallet"}
          </h2>
          {address ? (
            <>
              <p className="m-0 break-all font-mono text-[13px] text-cream/85">{address}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy()} className={BTN_SECONDARY}>
                  {copied ? "Copied" : "Copy address"}
                </button>
                <a href={explorerUrl(account.chainConfig, "address", address)} target="_blank" rel="noreferrer" className={BTN_SECONDARY}>
                  Explorer <ExternalMark />
                </a>
                <button type="button" onClick={() => void wallet.disconnect()} className={BTN_SECONDARY}>
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="m-0 text-[14px] leading-relaxed text-muted">MetaMask, Rabby, Coinbase Wallet or a phone wallet over WalletConnect.</p>
              <ConnectWalletButton />
            </>
          )}
        </section>

        {MARKET_CHAINS.enabled.map((c, i) => (
          <ChainFunds key={c} chain={c} step={i + 2} address={address} />
        ))}
      </div>
    </div>
  );
}

/** One market chain's balance and how to fund it: USDC on both; ETH for gas on Base. */
function ChainFunds({ chain, step, address }: { chain: MarketChainId; step: number; address: string | null }) {
  const account = useArcAccount(chain);
  const cfg = account.chainConfig;
  const eth = cfg.gas.symbol === "ETH";
  return (
    <section aria-labelledby={`wallet-step-${step}`} className={`${SURFACE} grid content-start gap-3 p-5 sm:p-6`}>
      <h2 id={`wallet-step-${step}`} className="m-0 flex items-center gap-2 text-[1.2rem] leading-none text-cream">
        {step}. USDC on {cfg.label} <ChainBadge chain={chain} withLabel={false} />
      </h2>
      {address ? (
        <p className="m-0 flex h-10 items-center gap-3 font-mono text-[1.8rem] tabular-nums text-cream">
          {account.balance === null ? <Skeleton className="h-8 w-32" /> : usd(account.balance)}
          {eth && account.gas !== null ? <span className="text-[13px] text-muted">{(Number(account.gas) / 1e18).toFixed(5)} ETH for gas</span> : null}
        </p>
      ) : null}
      <p className="m-0 text-[14px] leading-relaxed text-muted">
        {cfg.network === "testnet" ? (
          <>
            Get test USDC from{" "}
            <a href={CIRCLE_FAUCET_URL} target="_blank" rel="noreferrer" className="text-coral hover:underline">
              Circle&apos;s faucet <ExternalMark />
            </a>{" "}
            (pick {cfg.name}) and send it to your address.{eth ? " You also need a little Base Sepolia ETH for gas (any Base Sepolia faucet)." : ""}
          </>
        ) : eth ? (
          <>Send USDC on Base to your address, plus a little ETH on Base for gas (a dollar of ETH covers many transactions).</>
        ) : (
          <>Send USDC on Arc to your address, from an exchange or another wallet. It pays for stakes and for gas.</>
        )}
      </p>
    </section>
  );
}
