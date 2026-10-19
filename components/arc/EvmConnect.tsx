"use client";

/**
 * Arc (EVM) wallet connect through Family's ConnectKit: injected wallets, Coinbase Wallet and WalletConnect (QR and
 * mobile) behind one modal. Loaded only when an Arc wallet is wanted (EvmConnectHost), since wagmi + WalletConnect is a
 * heavy bundle. It hands useEvmWallet a bridge: open the modal and wait for an account, and the connected EIP-1193
 * provider. The proof signature and everything after stays in useEvmWallet.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig, useModal } from "connectkit";
import { useEffect, useRef } from "react";
import { getAddress, type Address } from "viem";
import { createConfig, http, useConfig, WagmiProvider } from "wagmi";
import { disconnect, getAccount, watchAccount } from "wagmi/actions";

import { arcChain } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";

import { evmAccountChanged, registerEvmBridge, type Eip1193 } from "./useEvmWallet";

const arc = arcChain();
const config = createConfig(
  getDefaultConfig({
    chains: [arc],
    transports: { [arc.id]: http(ARC.chain.rpcUrl) },
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
    appName: "Mimir",
    appDescription: "Prediction markets settled by an AI council",
    appUrl: "https://mimirmarkets.xyz",
    appIcon: "https://mimirmarkets.xyz/icon.png",
    ssr: true,
  }),
);
const queryClient = new QueryClient();

/** Resolves once wagmi has finished restoring a previous connection. */
function settled(): Promise<void> {
  return new Promise((ok) => {
    if (getAccount(config).status !== "reconnecting") return ok();
    const stop = watchAccount(config, {
      onChange: (a) => {
        if (a.status !== "reconnecting") {
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
    const stop = watchAccount(cfg, {
      onChange: (a, prev) => {
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
        <ConnectKitProvider theme="midnight" options={{ initialChainId: arc.id, enforceSupportedChains: false }}>
          <Bridge />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
