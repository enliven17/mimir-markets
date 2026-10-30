"use client";

/**
 * The site's one EVM wallet connection, through Family's ConnectKit + wagmi: Arc, Robinhood Chain and Base on a single
 * config, so one connected account serves all three. Wallets come from EIP-6963 discovery (each browser extension by
 * name, so the one the user picks is the one that opens), MetaMask, Coinbase Wallet and WalletConnect (QR and phone
 * wallets, every chain optional). Loaded only when an EVM wallet is wanted (EvmConnectHost), since wagmi + WalletConnect
 * is a heavy bundle. It hands useEvmWallet a bridge; proofs, sends and everything after stay there.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig, getDefaultConnectors, useModal } from "connectkit";
import { useEffect, useRef } from "react";
import { defineChain, getAddress, type Address } from "viem";
import { base } from "viem/chains";
import { createConfig, http, injected, useConfig, WagmiProvider } from "wagmi";
import { disconnect, getAccount, switchChain, watchAccount, type GetAccountReturnType } from "wagmi/actions";

import { arcChain } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { BASE_CHAIN } from "@/lib/base/chain";
import { ROBINHOOD_CHAIN } from "@/lib/robinhood/chain";

import { evmAccountChanged, registerEvmBridge, reportEvmAccount, type Eip1193 } from "./useEvmWallet";

const arc = arcChain();
const robinhood = defineChain({
  id: ROBINHOOD_CHAIN.id,
  name: ROBINHOOD_CHAIN.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_CHAIN.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: ROBINHOOD_CHAIN.explorer } },
});
const baseChain = { ...base, rpcUrls: { default: { http: [BASE_CHAIN.rpcUrl] } } } as typeof base;

const app = {
  name: "Mimir",
  description: "Prediction markets settled by an AI council",
  url: "https://mimirmarkets.xyz",
  icon: "https://mimirmarkets.xyz/icon.png",
};
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/**
 * A phone wallet's own browser (Robinhood Wallet, MetaMask, Coinbase) injects one provider and may not announce it over
 * EIP-6963: offer it as "Browser Wallet" there. On desktop EIP-6963 names every extension, so no `window.ethereum` pick.
 */
const inWalletBrowser =
  typeof window !== "undefined" &&
  Boolean((window as { ethereum?: unknown }).ethereum) &&
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const config = createConfig(
  getDefaultConfig({
    // Base first: the most wallets know it, so a WalletConnect session opens there. Every chain stays optional.
    chains: [baseChain, arc, robinhood],
    transports: {
      [baseChain.id]: http(BASE_CHAIN.rpcUrl),
      [arc.id]: http(ARC.chain.rpcUrl),
      [robinhood.id]: http(ROBINHOOD_CHAIN.rpcUrl),
    },
    connectors: [
      ...(inWalletBrowser ? [injected({ shimDisconnect: true })] : []),
      // No Aave Account: its social-login popup is not a wallet anyone here asked for.
      ...getDefaultConnectors({ app, walletConnectProjectId, enableAaveAccount: false }),
    ],
    walletConnectProjectId,
    appName: app.name,
    appDescription: app.description,
    appUrl: app.url,
    appIcon: app.icon,
    enableAaveAccount: false,
    ssr: true,
  }),
);
const queryClient = new QueryClient();

const viaOf = (a: GetAccountReturnType) => (!a.connector ? null : a.connector.type === "walletConnect" ? "walletconnect" : "injected");

/** Resolves once wagmi has finished restoring a previous connection. */
function settled(): Promise<void> {
  return new Promise((ok) => {
    if (!["reconnecting", "connecting"].includes(getAccount(config).status)) return ok();
    const stop = watchAccount(config, {
      onChange: (a) => {
        if (a.status !== "reconnecting" && a.status !== "connecting") {
          stop();
          ok();
        }
      },
    });
  });
}

function Bridge() {
  const { open, setOpen } = useModal();
  const cfg = useConfig();
  const pending = useRef<{ ok: (a: Address) => void; fail: (e: Error) => void } | null>(null);

  // Closing the modal without picking an account ends the wait.
  useEffect(() => {
    if (open || !pending.current) return;
    const id = setTimeout(() => {
      if (getAccount(cfg).address) return;
      pending.current?.fail(new Error("No wallet was connected."));
      pending.current = null;
    }, 300);
    return () => clearTimeout(id);
  }, [open, cfg]);

  useEffect(() => {
    const report = (a: GetAccountReturnType) => {
      // Mid-restore the account is not known yet: keep the last report.
      if (a.status === "reconnecting" || a.status === "connecting") return;
      reportEvmAccount(a.address ? getAddress(a.address) : null, viaOf(a));
    };
    report(getAccount(cfg));
    const stop = watchAccount(cfg, {
      onChange: (a, prev) => {
        report(a);
        if (a.address && pending.current) {
          pending.current.ok(getAddress(a.address));
          pending.current = null;
          setOpen(false);
        }
        if (prev.address && a.address !== prev.address) evmAccountChanged(a.address ? getAddress(a.address) : null);
      },
    });
    registerEvmBridge({
      async connect() {
        await settled();
        const now = getAccount(cfg).address;
        if (now) return getAddress(now);
        pending.current?.fail(new Error("No wallet was connected."));
        return new Promise<Address>((ok, fail) => {
          pending.current = { ok, fail };
          setOpen(true);
        });
      },
      async provider() {
        await settled();
        const { connector, address } = getAccount(cfg);
        if (!connector || !address) return null;
        return { address: getAddress(address), provider: (await connector.getProvider()) as Eip1193 };
      },
      async switchChain(chainId) {
        await settled();
        if (getAccount(cfg).chainId === chainId) return;
        await switchChain(cfg, { chainId: chainId as (typeof cfg.chains)[number]["id"] });
      },
      disconnect: () => disconnect(cfg),
    });
    return () => {
      stop();
      registerEvmBridge(null);
    };
  }, [cfg, setOpen]);
  return null;
}

export default function EvmConnect() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {/* initialChainId 0: connecting never asks the wallet to switch networks; sends do, right before signing. */}
        <ConnectKitProvider theme="midnight" options={{ initialChainId: 0, enforceSupportedChains: false, hideBalance: true }}>
          <Bridge />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
