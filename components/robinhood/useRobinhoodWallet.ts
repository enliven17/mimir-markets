"use client";

/**
 * The connected Robinhood Chain wallet: an EVM account that can stand in for the Solana wallet as the owner of an
 * Arc account (lib/owner.ts). Robinhood Wallet on a phone connects over WalletConnect (QR, or the deep link on the
 * same phone); a browser wallet or Robinhood Wallet's own dApp browser is the injected provider. Only signing is
 * needed here, so the wallet's network does not matter. The same connection funds Base agents (any EVM wallet): the
 * seed send switches it to Base first.
 *
 * One module-level connection shared by every hook (useSyncExternalStore). The WalletConnect provider loads only
 * when asked for, like the Solana side (lib/solana/wallet-providers.tsx).
 */
import { useSyncExternalStore } from "react";
import { toHex } from "viem";

import { BASE_CHAIN } from "@/lib/base/chain";
import { ROBINHOOD_CHAIN } from "@/lib/robinhood/chain";

type Eip1193 = {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  disconnect?(): Promise<void>;
};
type Via = "injected" | "walletconnect";
type State = { address: `0x${string}` | null; via: Via | null; connecting: boolean };

const STORE_KEY = "mimir.robinhood.via";
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

let state: State = { address: null, via: null, connecting: false };
let provider: Eip1193 | null = null;
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
};

const injected = (): Eip1193 | null =>
  typeof window === "undefined" ? null : ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null);

function remember(via: Via | null) {
  try {
    if (via) localStorage.setItem(STORE_KEY, via);
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode: no auto-restore, nothing else breaks */
  }
}

async function walletConnect(): Promise<Eip1193> {
  if (!WALLETCONNECT_PROJECT_ID) throw new Error("WalletConnect is not configured on this site.");
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  return (await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [ROBINHOOD_CHAIN.id],
    optionalChains: [BASE_CHAIN.id],
    rpcMap: { [ROBINHOOD_CHAIN.id]: ROBINHOOD_CHAIN.rpcUrl, [BASE_CHAIN.id]: BASE_CHAIN.rpcUrl },
    showQrModal: true,
    metadata: {
      name: "Mimir",
      description: "AI-settled prediction markets",
      url: window.location.origin,
      icons: [`${window.location.origin}/icon.svg`],
    },
  })) as unknown as Eip1193;
}

function watch(p: Eip1193) {
  p.on?.("accountsChanged", (accounts) => {
    const a = (accounts as string[] | undefined)?.[0];
    if (p === provider) set({ address: (a as `0x${string}` | undefined) ?? null });
  });
  p.on?.("disconnect", () => {
    if (p === provider) void disconnectRobinhood();
  });
}

async function connectRobinhood(via: Via): Promise<void> {
  if (state.connecting) return;
  set({ connecting: true });
  try {
    const p = via === "injected" ? injected() : await walletConnect();
    if (!p) throw new Error("No browser wallet found. Open Mimir in Robinhood Wallet's browser, or connect with a QR code.");
    const accounts = via === "walletconnect" ? await (p as unknown as { enable(): Promise<string[]> }).enable() : ((await p.request({ method: "eth_requestAccounts" })) as string[]);
    if (!accounts[0]) throw new Error("The wallet shared no account.");
    provider = p;
    watch(p);
    remember(via);
    set({ address: accounts[0] as `0x${string}`, via });
  } finally {
    set({ connecting: false });
  }
}

async function disconnectRobinhood(): Promise<void> {
  const p = provider;
  provider = null;
  remember(null);
  set({ address: null, via: null });
  await p?.disconnect?.().catch(() => undefined);
}

/** Silent restore on load: an injected wallet that already allowed this site, or a live WalletConnect session. */
let restored = false;
function restore() {
  if (restored || typeof window === "undefined") return;
  restored = true;
  let via: string | null = null;
  try {
    via = localStorage.getItem(STORE_KEY);
  } catch {
    return;
  }
  const silent = async () => {
    const p = via === "injected" ? injected() : via === "walletconnect" ? await walletConnect() : null;
    if (!p) return;
    const accounts = (await p.request({ method: "eth_accounts" })) as string[];
    if (!accounts[0]) return remember(null);
    provider = p;
    watch(p);
    set({ address: accounts[0] as `0x${string}`, via: via as Via });
  };
  silent().catch(() => remember(null));
}

type EvmChain = { id: number; name: string; rpcUrl: string; explorer: string };

/** Put the wallet on Robinhood Chain or Base (adding the network if it does not know it yet). */
async function onChain(p: Eip1193, chain: EvmChain = ROBINHOOD_CHAIN) {
  const chainId = toHex(chain.id);
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    if ((err as { code?: number })?.code !== 4902) throw err;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: chain.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [chain.rpcUrl], blockExplorerUrls: [chain.explorer] }],
    });
  }
}

/** A plain ETH transfer on Robinhood Chain from the connected wallet. Returns the tx hash. */
async function sendEthRobinhood(to: string, wei: bigint): Promise<`0x${string}`> {
  if (!provider || !state.address) throw new Error("Connect your Robinhood wallet first.");
  await onChain(provider, ROBINHOOD_CHAIN);
  return (await provider.request({ method: "eth_sendTransaction", params: [{ from: state.address, to, value: toHex(wei) }] })) as `0x${string}`;
}

/** A plain ETH transfer on Base from the connected wallet. Returns the tx hash. */
async function sendEthBase(to: string, wei: bigint): Promise<`0x${string}`> {
  if (!provider || !state.address) throw new Error("Connect your EVM wallet first.");
  await onChain(provider, BASE_CHAIN);
  return (await provider.request({ method: "eth_sendTransaction", params: [{ from: state.address, to, value: toHex(wei) }] })) as `0x${string}`;
}

async function signRobinhood(text: string): Promise<string> {
  if (!provider || !state.address) throw new Error("Connect your Robinhood wallet first.");
  return (await provider.request({ method: "personal_sign", params: [toHex(text), state.address] })) as string;
}

const subscribe = (fn: () => void) => {
  restore();
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const SERVER: State = { address: null, via: null, connecting: false };

export function useRobinhoodWallet() {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  return {
    ...s,
    walletConnectReady: Boolean(WALLETCONNECT_PROJECT_ID),
    connect: connectRobinhood,
    disconnect: disconnectRobinhood,
    sign: s.address ? signRobinhood : null,
    sendEth: s.address ? sendEthRobinhood : null,
    sendEthBase: s.address ? sendEthBase : null,
  };
}
