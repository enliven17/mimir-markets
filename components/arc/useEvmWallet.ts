"use client";

/**
 * The browser's one wallet connection: an EVM wallet through ConnectKit + wagmi (EvmConnect.tsx, loaded on demand by
 * EvmConnectHost), on Arc or Base. The connected address is the user's identity and market account. EvmConnect hands
 * this module a bridge, and every wallet action goes through it. Connecting never switches the network; a transaction
 * switches to its chain right before sending.
 */
import { useSyncExternalStore } from "react";
import { createWalletClient, custom, numberToHex, toHex, type Address, type Hex } from "viem";

import { eoaSession, type ArcSession } from "@/lib/arc/session";
import { BASE_CHAIN } from "@/lib/base/chain";
import { chainPublicClient, viemChainOf } from "@/lib/chains/client";
import { MARKET_CHAINS, marketChain, type MarketChainId } from "@/lib/chains/registry";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** What EvmConnect exposes: open the modal and wait for an account, the connected wallet's provider, a chain switch. */
export interface EvmBridge {
  connect(): Promise<Address>;
  provider(): Promise<{ address: Address; provider: Eip1193 } | null>;
  /** Put the wallet on `chainId` (wagmi adds the network when the wallet does not know it). */
  switchChain(chainId: number): Promise<void>;
  disconnect(): Promise<void>;
}

export type EvmChainIntent = "arc" | "base" | "solana";

/** The live wagmi account: the same address on Arc and Base. */
export interface EvmAccount {
  address: Address | null;
  via: "injected" | "walletconnect" | null;
  connecting: boolean;
  /** The network picked when connecting (ConnectSheet); the connection itself stays on whatever chain the wallet is on. */
  intent: EvmChainIntent | null;
}

/** Set while wagmi holds a connection, so a reload mounts ConnectKit to restore it. */
const CONNECTED_KEY = "mimir:evm-connected";
/** Older keys from earlier wallet versions: only cleaned up. */
const LEGACY_KEYS = ["mimir:evm-wallet", "mimir.robinhood.via", "mimir:entry-mode"];

let loaded = false;
let bridge: EvmBridge | null = null;
let bridgeWaiters: ((b: EvmBridge) => void)[] = [];
let wanted = false;
const wantListeners = new Set<() => void>();

function want() {
  if (wanted) return;
  wanted = true;
  wantListeners.forEach((l) => l());
}

/** EvmConnect registers itself on mount (null on unmount). */
export function registerEvmBridge(b: EvmBridge | null) {
  bridge = b;
  if (!b) return;
  bridgeWaiters.forEach((w) => w(b));
  bridgeWaiters = [];
}

function bridgeReady(): Promise<EvmBridge> {
  want();
  return bridge ? Promise.resolve(bridge) : new Promise((ok) => bridgeWaiters.push(ok));
}

/** Switching accounts in the wallet: a stored wallet proof (useWalletProof) belongs to the old address. */
export function evmAccountChanged(next: Address | null) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mimir-wallet-changed", { detail: next }));
}

const NO_ACCOUNT: EvmAccount = { address: null, via: null, connecting: false, intent: null };
let account: EvmAccount = NO_ACCOUNT;
const accountListeners = new Set<() => void>();

// The network the wallet is used on (picked in the connect sheet, then the chain of the last send), so labels name it.
const INTENT_KEY = "mimir:evm-intent";
const INTENTS: readonly EvmChainIntent[] = ["arc", "base"];

function setAccount(next: Partial<EvmAccount>) {
  account = { ...account, ...next };
  if ("intent" in next) {
    try {
      if (next.intent) localStorage.setItem(INTENT_KEY, next.intent);
      else localStorage.removeItem(INTENT_KEY);
    } catch {
      /* storage blocked: the label falls back to "EVM wallet" after a reload */
    }
  }
  accountListeners.forEach((l) => l());
}

/** The network name for a wallet label, or null when not known. */
export const evmNetworkName = (intent: EvmChainIntent | null) => (intent === "arc" ? "Arc" : intent === "base" ? "Base" : null);

const intentOfChain = (chainId: number): EvmChainIntent | null =>
  chainId === MARKET_CHAINS.chains.arc.chainId ? "arc" : chainId === MARKET_CHAINS.chains.base.chainId || chainId === BASE_CHAIN.id ? "base" : null;

/** EvmConnect reports the wagmi account here (address null once disconnected). */
export function reportEvmAccount(address: Address | null, via: EvmAccount["via"]) {
  if (address === account.address && via === account.via) return;
  let intent = account.intent;
  if (address && !intent) {
    try {
      const stored = localStorage.getItem(INTENT_KEY) as EvmChainIntent | null;
      intent = stored && INTENTS.includes(stored) ? stored : null;
    } catch {
      /* storage blocked */
    }
  }
  setAccount({ address, via, intent: address ? intent : account.intent });
  try {
    if (address) localStorage.setItem(CONNECTED_KEY, "1");
    else localStorage.removeItem(CONNECTED_KEY);
  } catch {
    /* storage blocked: no restore on reload */
  }
}

/** The live account's address, outside React. */
export const currentEvmAddress = () => account.address;

/** The network the live account was last used on, outside React. */
export const currentEvmIntent = () => account.intent;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  let restore = false;
  try {
    restore = localStorage.getItem(CONNECTED_KEY) === "1";
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
  // A stored connection needs the wallet back for its transactions: let ConnectKit restore it.
  if (restore) wanted = true;
}

/** The live EVM account, shared by every component. */
export const useEvmAccount = () =>
  useSyncExternalStore(
    (l) => {
      load();
      accountListeners.add(l);
      return () => accountListeners.delete(l);
    },
    () => account,
    () => NO_ACCOUNT,
  );

/** True once something needs the wallet (a stored connection, or a connect click): EvmConnectHost mounts ConnectKit. */
export const useEvmWanted = () =>
  useSyncExternalStore(
    (l) => {
      wantListeners.add(l);
      return () => wantListeners.delete(l);
    },
    () => (load(), wanted),
    () => false,
  );

/** The connected wallet's provider, for `address`; reconnects through the modal when the wallet dropped. */
async function need(address?: Address): Promise<Eip1193> {
  const b = await bridgeReady();
  let got = await b.provider();
  if (!got) {
    await b.connect();
    got = await b.provider();
  }
  if (!got) throw new Error("No wallet is connected.");
  if (address && got.address !== address) throw new Error(`Switch your wallet back to ${address}, or reconnect.`);
  return got.provider;
}

/** Put the wallet on `chainId` right before a transaction (never on connect), and label the wallet with it. */
export async function switchEvmChain(chainId: number): Promise<void> {
  await (await bridgeReady()).switchChain(chainId);
  const intent = intentOfChain(chainId);
  if (intent && intent !== account.intent) setAccount({ intent });
}

/** EIP-191 personal_sign of a UTF-8 message. */
export async function signWithEvm(address: Address, message: string): Promise<Hex> {
  return (await (await need(address)).request({ method: "personal_sign", params: [toHex(message), address] })) as Hex;
}

/** Open ConnectKit (or reuse the live connection) and resolve with the account; no signature, no network switch. */
export async function connectEvm(intent?: EvmChainIntent): Promise<Address> {
  if (account.connecting) throw new Error("A wallet connection is already open.");
  setAccount({ connecting: true, ...(intent ? { intent } : {}) });
  try {
    return await (await bridgeReady()).connect();
  } finally {
    setAccount({ connecting: false });
  }
}

/** Ends the wallet connection. */
export async function disconnectEvm(): Promise<void> {
  setAccount({ intent: null });
  reportEvmAccount(null, null);
  evmAccountChanged(null);
  await bridge?.disconnect().catch(() => {});
}

/** One transaction on `chainId` from the connected wallet (switches the wallet first). Returns the tx hash. */
export async function sendEvmTransaction(chainId: number, tx: { from: Address; to: Address; data?: Hex; value?: Hex }): Promise<Hex> {
  const p = await need(tx.from);
  await switchEvmChain(chainId);
  return (await p.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
}

/** A plain native transfer on `chainId` (Base) from the connected wallet. Returns the tx hash. */
export async function sendEvmEth(chainId: number, to: Address, wei: bigint): Promise<Hex> {
  const from = account.address;
  if (!from) throw new Error("Connect your wallet first.");
  return sendEvmTransaction(chainId, { from, to, value: numberToHex(wei) });
}

/**
 * The market session on `chain` for the connected wallet: each call is a transaction from it (Arc: gas in USDC; Base:
 * gas in ETH). Base calldata carries Mimir's Builder Code suffix when NEXT_PUBLIC_BASE_BUILDER_SUFFIX is set.
 */
export function marketSessionFor(chain: MarketChainId, address: Address): ArcSession {
  const c = marketChain(chain);
  const suffix = chain === "base" ? builderSuffix() : null;
  return eoaSession({
    chainId: c.chainId,
    address,
    switchChain: switchEvmChain,
    sendTransaction: (tx) => sendEvmTransaction(c.chainId, suffix ? { ...tx, data: `${tx.data}${suffix.slice(2)}` as Hex } : tx),
    waitForReceipt: (hash) => chainPublicClient(c).waitForTransactionReceipt({ hash, timeout: 120_000 }),
    signMessage: (message) => signWithEvm(address, message),
  });
}

/** The market session on Arc (older callers). */
export const arcSessionFor = (address: Address): ArcSession => marketSessionFor("arc", address);

/** The pre-encoded ERC-8021 suffix (lib/base/builder-code.ts) from the public env; null when unset or malformed. */
function builderSuffix(): Hex | null {
  const v = process.env.NEXT_PUBLIC_BASE_BUILDER_SUFFIX?.trim().toLowerCase();
  return v && /^0x([0-9a-f]{2})+80218021802180218021802180218021$/.test(v) ? (v as Hex) : null;
}

/** EIP-712 typed data signed by the connected wallet (eth_signTypedData_v4 through viem), on `chain`. */
export async function signTypedDataWithEvm(chain: MarketChainId, address: Address, typed: Parameters<ReturnType<typeof createWalletClient>["signTypedData"]>[0]): Promise<Hex> {
  const p = await need(address);
  await switchEvmChain(marketChain(chain).chainId);
  const client = createWalletClient({ account: address, chain: viemChainOf(marketChain(chain)), transport: custom(p) });
  return client.signTypedData({ ...typed, account: address } as Parameters<typeof client.signTypedData>[0]);
}
