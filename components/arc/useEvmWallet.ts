"use client";

/**
 * The browser's Arc (EVM) wallet, for native Arc sign-in (lib/arc/evm.ts): any injected EIP-1193 wallet
 * (window.ethereum), no SDK. Connecting also signs the wallet proof (evmProofMessage) used for access and invite codes;
 * address and proof are a per-browser convenience in localStorage, shared by every component through one store.
 */
import { useSyncExternalStore } from "react";
import { erc20Abi, getAddress, numberToHex, type Address, type Hex } from "viem";

import { arcPublicClient, arcUsdcUnits } from "@/lib/arc/chain";
import { ARC, ARC_USDC } from "@/lib/arc/config";
import { EVM_PROOF_HEADER, EVM_WALLET_HEADER, evmProofMessage, parseEvmProofHeader } from "@/lib/arc/evm";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
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

const provider = (): Eip1193 | null => (typeof window === "undefined" ? null : ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null));

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
  // Switching accounts in the wallet ends this sign-in: the proof belongs to the old address.
  provider()?.on?.("accountsChanged", (accounts) => {
    const next = Array.isArray(accounts) && typeof accounts[0] === "string" ? getAddress(accounts[0]) : null;
    if (next !== state.address) set(EMPTY);
  });
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

function need(): Eip1193 {
  const p = provider();
  if (!p) throw new Error("No Arc wallet found in this browser. Install an EVM wallet (MetaMask, Rabby, Coinbase Wallet) and reload.");
  return p;
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
  return (await need().request({
    method: "personal_sign",
    params: [message, address],
  })) as Hex;
}

/** Connect, then sign the wallet proof: one click, one signature. */
export async function connectEvmWallet(): Promise<Address> {
  const p = need();
  const accounts = (await p.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts[0]) throw new Error("The wallet shared no account.");
  const address = getAddress(accounts[0]);
  const signedAt = Date.now();
  const signature = await signWithEvm(address, evmProofMessage(address, signedAt));
  set({ address, proof: `${signedAt}.${signature}` });
  return address;
}

export const disconnectEvmWallet = () => set(EMPTY);

/** A transaction on Arc Usdc's ERC-20 interface from the wallet (approve / transfer); resolves once mined. */
export async function sendUsdcTx(from: Address, data: Hex): Promise<Hex> {
  const p = need();
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
