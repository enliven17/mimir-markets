"use client";

/**
 * The browser's one EVM wallet connection, for Arc, Robinhood Chain and Base alike: ConnectKit + wagmi (EvmConnect.tsx,
 * loaded on demand by EvmConnectHost) hands this module a bridge, and every EVM action goes through it. Connecting never
 * switches the network; a transaction switches to its chain right before sending.
 *
 * Two stores share it: the live account (useEvmAccount, what useRobinhoodWallet reads), and the native Arc sign-in
 * (useEvmWallet): connecting for Arc also signs the wallet proof (evmProofMessage) used for access and invite codes;
 * address and proof are a per-browser convenience in localStorage.
 */
import { useSyncExternalStore } from "react";
import { erc20Abi, getAddress, numberToHex, type Address, type Hex } from "viem";

import { arcPublicClient, arcUsdcUnits } from "@/lib/arc/chain";
import { ARC, ARC_USDC } from "@/lib/arc/config";
import { BASE_CHAIN } from "@/lib/base/chain";
import { ROBINHOOD_CHAIN } from "@/lib/robinhood/chain";
import { EVM_PROOF_HEADER, EVM_WALLET_HEADER, evmProofMessage, parseEvmProofHeader } from "@/lib/arc/evm";

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

export type EvmChainIntent = "arc" | "robinhood" | "base";

/** The live wagmi account: the same address on Arc, Robinhood Chain and Base. */
export interface EvmAccount {
  address: Address | null;
  via: "injected" | "walletconnect" | null;
  connecting: boolean;
  /** The network picked when connecting (ConnectSheet); the connection itself stays on whatever chain the wallet is on. */
  intent: EvmChainIntent | null;
}

export interface EvmWalletState {
  address: Address | null;
  /** `signedAt.signature`, for the x-mimir-evm-proof header; null when missing or expired. */
  proof: string | null;
}

const KEY = "mimir:evm-wallet";
/** Set while wagmi holds a connection, so a reload mounts ConnectKit to restore it. */
const CONNECTED_KEY = "mimir:evm-connected";
/** The old raw Robinhood/Base connection (before ConnectKit): only cleaned up. */
const LEGACY_KEY = "mimir.robinhood.via";
const EMPTY: EvmWalletState = { address: null, proof: null };
let state: EvmWalletState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

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

/** Switching accounts in the wallet ends this sign-in: the proof belongs to the old address. */
export function evmAccountChanged(next: Address | null) {
  if (state.address && next !== state.address) set(EMPTY);
}

const NO_ACCOUNT: EvmAccount = { address: null, via: null, connecting: false, intent: null };
let account: EvmAccount = NO_ACCOUNT;
const accountListeners = new Set<() => void>();

// The network the wallet is used on (picked in the connect sheet, then the chain of the last send), so labels name it.
const INTENT_KEY = "mimir:evm-intent";
const INTENTS: readonly EvmChainIntent[] = ["arc", "robinhood", "base"];

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
export const evmNetworkName = (intent: EvmChainIntent | null) =>
  intent === "arc" ? "Arc" : intent === "robinhood" ? "Robinhood Chain" : intent === "base" ? "Base" : null;

const intentOfChain = (chainId: number): EvmChainIntent | null =>
  chainId === ARC.chain.id ? "arc" : chainId === ROBINHOOD_CHAIN.id ? "robinhood" : chainId === BASE_CHAIN.id ? "base" : null;

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

/** True once something needs the Arc wallet (a stored sign-in, or a connect click): EvmConnectHost mounts ConnectKit. */
export const useEvmWanted = () =>
  useSyncExternalStore(
    (l) => {
      wantListeners.add(l);
      return () => wantListeners.delete(l);
    },
    () => (load(), wanted),
    () => false,
  );

function load(): EvmWalletState {
  if (loaded || typeof window === "undefined") return state;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as {
      address?: string;
      proof?: string;
    } | null;
    if (raw?.address)
      state = {
        address: getAddress(raw.address),
        proof: raw.proof && parseEvmProofHeader(raw.proof) ? raw.proof : null,
      };
  } catch {
    /* unreadable: start empty */
  }
  let restore = false;
  try {
    restore = localStorage.getItem(CONNECTED_KEY) === "1";
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage blocked */
  }
  // A stored sign-in or connection needs the wallet back for its transactions: let ConnectKit restore it.
  if (state.address || restore) wanted = true;
  return state;
}

function set(next: EvmWalletState) {
  state = next;
  try {
    if (next.address) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: just not remembered */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Headers carrying the Arc wallet proof, or {} when there is none. */
export function evmProofHeaders(): Record<string, string> {
  const s = load();
  return s.address && s.proof ? { [EVM_WALLET_HEADER]: s.address, [EVM_PROOF_HEADER]: s.proof } : {};
}

/** The connected wallet's provider, for `address`; reconnects through the modal when the wallet dropped. */
async function need(address?: Address): Promise<Eip1193> {
  const b = await bridgeReady();
  let got = await b.provider();
  if (!got) {
    await b.connect();
    got = await b.provider();
  }
  if (!got) throw new Error("No Arc wallet is connected.");
  if (address && got.address !== address) throw new Error(`Switch your wallet back to ${address} or sign in again.`);
  return got.provider;
}

/** Put the wallet on `chainId` right before a transaction (never on connect). */
export async function switchEvmChain(chainId: number): Promise<void> {
  await (await bridgeReady()).switchChain(chainId);
}

export async function signWithEvm(address: Address, message: string): Promise<Hex> {
  return (await (await need(address)).request({
    method: "personal_sign",
    params: [message, address],
  })) as Hex;
}

/**
 * Open ConnectKit (or reuse the live connection) and resolve with the account; no signature, no network switch.
 * `intent` records which network the user picked.
 */
export async function connectEvm(intent?: EvmChainIntent): Promise<Address> {
  if (account.connecting) throw new Error("A wallet connection is already open.");
  setAccount({ connecting: true, ...(intent ? { intent } : {}) });
  try {
    return await (await bridgeReady()).connect();
  } finally {
    setAccount({ connecting: false });
  }
}

/** Ends the EVM connection everywhere: Arc sign-in, Robinhood Chain and Base. */
export async function disconnectEvm(): Promise<void> {
  set(EMPTY);
  setAccount({ intent: null });
  reportEvmAccount(null, null);
  await bridge?.disconnect().catch(() => {});
}

/** A plain ETH transfer on `chainId` (Robinhood Chain, Base) from the connected wallet. Returns the tx hash. */
export async function sendEvmEth(chainId: number, to: string, wei: bigint): Promise<Hex> {
  const from = account.address;
  if (!from) throw new Error("Connect your EVM wallet first.");
  const p = await need(from);
  await switchEvmChain(chainId);
  const intent = intentOfChain(chainId);
  if (intent) setAccount({ intent });
  return (await p.request({ method: "eth_sendTransaction", params: [{ from, to, value: numberToHex(wei) }] })) as Hex;
}

/** Connect for Arc, then sign the wallet proof: one click, one signature. */
export async function connectEvmWallet(): Promise<Address> {
  const address = await connectEvm("arc");
  const signedAt = Date.now();
  const signature = await signWithEvm(address, evmProofMessage(address, signedAt));
  set({ address, proof: `${signedAt}.${signature}` });
  return address;
}

export function disconnectEvmWallet() {
  void disconnectEvm();
}

/** A transaction on Arc Usdc's ERC-20 interface from the wallet (approve / transfer); resolves once mined. */
export async function sendUsdcTx(from: Address, data: Hex): Promise<Hex> {
  const p = await need(from);
  await switchEvmChain(ARC.chain.id);
  setAccount({ intent: "arc" });
  const hash = (await p.request({
    method: "eth_sendTransaction",
    params: [{ from, to: ARC_USDC, data }],
  })) as Hex;
  const receipt = await arcPublicClient().waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  if (receipt.status !== "success") throw new Error(`The transaction reverted (tx ${hash}).`);
  return hash;
}

/** What the passkey account may still draw from the wallet, and what the wallet holds, in 6-dp units. */
export async function readWalletFunding(wallet: Address, account: Address): Promise<{ allowanceUnits: bigint; walletUnits: bigint }> {
  const [allowanceUnits, walletUnits] = await Promise.all([
    arcPublicClient().readContract({
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet, account],
    }),
    arcUsdcUnits(wallet),
  ]);
  return { allowanceUnits, walletUnits };
}

export function useEvmWallet(): EvmWalletState {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}
