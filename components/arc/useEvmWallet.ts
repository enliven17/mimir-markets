"use client";

/**
 * The browser's Arc (EVM) wallet, for native Arc sign-in (lib/arc/evm.ts). The wallet itself comes from ConnectKit
 * (EvmConnect.tsx, loaded on demand by EvmConnectHost), which hands this store a bridge. Connecting also signs the
 * wallet proof (evmProofMessage) used for access and invite codes; address and proof are a per-browser convenience in
 * localStorage, shared by every component through one store.
 */
import { useSyncExternalStore } from "react";
import { erc20Abi, getAddress, numberToHex, type Address, type Hex } from "viem";

import { arcPublicClient, arcUsdcUnits } from "@/lib/arc/chain";
import { ARC, ARC_USDC } from "@/lib/arc/config";
import { EVM_PROOF_HEADER, EVM_WALLET_HEADER, evmProofMessage, parseEvmProofHeader } from "@/lib/arc/evm";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** What EvmConnect exposes: open the modal and wait for an account, and the connected wallet's provider. */
export interface EvmBridge {
  connect(): Promise<Address>;
  provider(): Promise<{ address: Address; provider: Eip1193 } | null>;
  disconnect(): Promise<void>;
}

export interface EvmWalletState {
  address: Address | null;
  /** `signedAt.signature`, for the x-mimir-evm-proof header; null when missing or expired. */
  proof: string | null;
}

const KEY = "mimir:evm-wallet";
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
  // A stored sign-in needs the wallet back for its transactions: let ConnectKit restore the connection.
  if (state.address) wanted = true;
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

/** Put the wallet on Arc, adding the network when it does not know it. */
async function onArc(p: Eip1193) {
  const chainId = numberToHex(ARC.chain.id);
  if ((await p.request({ method: "eth_chainId" })) === chainId) return;
  try {
    await p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (err) {
    if ((err as { code?: number }).code !== 4902) throw err;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: ARC.chain.name,
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: ARC.chain.rpcUrls,
          blockExplorerUrls: [ARC.chain.explorer],
        },
      ],
    });
  }
}

export async function signWithEvm(address: Address, message: string): Promise<Hex> {
  return (await (await need(address)).request({
    method: "personal_sign",
    params: [message, address],
  })) as Hex;
}

/** Connect, then sign the wallet proof: one click, one signature. */
export async function connectEvmWallet(): Promise<Address> {
  const address = await (await bridgeReady()).connect();
  const signedAt = Date.now();
  const signature = await signWithEvm(address, evmProofMessage(address, signedAt));
  set({ address, proof: `${signedAt}.${signature}` });
  return address;
}

export function disconnectEvmWallet() {
  set(EMPTY);
  void bridge?.disconnect().catch(() => {});
}

/** A transaction on Arc Usdc's ERC-20 interface from the wallet (approve / transfer); resolves once mined. */
export async function sendUsdcTx(from: Address, data: Hex): Promise<Hex> {
  const p = await need(from);
  await onArc(p);
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
