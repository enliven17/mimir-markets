"use client";

/**
 * The connected wallet's stored wallet proof (lib/wallet-proof.ts). The proof
 * is a per-browser convenience in localStorage: it lets routes that act for a
 * wallet (access, invite codes, follows) know it is this one, and expires in 24h.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

import { useRobinhoodWallet } from "@/components/robinhood/useRobinhoodWallet";

import {
  WALLET_PROOF_HEADER,
  WALLET_HEADER,
  formatProofHeader,
  walletProofMessage,
  parseProofHeader,
} from "@/lib/wallet-proof";

const proofKey = (wallet: string) => `mimir.wallet-proof.${wallet}`;

function readProof(wallet: string): string | null {
  try {
    const v = localStorage.getItem(proofKey(wallet));
    return v && parseProofHeader(v) ? v : null;
  } catch {
    return null;
  }
}

/** Headers carrying the connected wallet's proof, or {} when there is none. */
export function walletProofHeaders(wallet: string | null | undefined): Record<string, string> {
  if (!wallet) return {};
  const proof = readProof(wallet);
  return proof ? { [WALLET_HEADER]: wallet, [WALLET_PROOF_HEADER]: proof } : {};
}

export function useWalletProof() {
  const { publicKey, signMessage } = useWallet();
  const robinhood = useRobinhoodWallet();
  // The Solana wallet when there is one, else a Robinhood Chain wallet (lib/owner.ts).
  const solana = publicKey?.toBase58() ?? null;
  const wallet = solana ?? robinhood.address;
  const signRobinhood = solana ? null : robinhood.sign;
  const [proven, setProven] = useState(false);

  useEffect(() => {
    const syncProof = () => setProven(wallet ? readProof(wallet) !== null : false);
    syncProof();
    window.addEventListener("mimir-wallet-proof", syncProof);
    return () => window.removeEventListener("mimir-wallet-proof", syncProof);
  }, [wallet]);

  const prove = useCallback(async () => {
    if (!wallet || !(signRobinhood ?? signMessage)) throw new Error("this wallet cannot sign messages");
    const signedAt = Date.now();
    const message = walletProofMessage(wallet, signedAt);
    const sig = signRobinhood ? await signRobinhood(message) : bs58.encode(await signMessage!(new TextEncoder().encode(message)));
    try {
      localStorage.setItem(proofKey(wallet), formatProofHeader(signedAt, sig));
    } catch {
      /* storage blocked: the proof just is not remembered */
    }
    setProven(true);
    window.dispatchEvent(new Event("mimir-wallet-proof"));
  }, [wallet, signMessage, signRobinhood]);

  return { wallet, proven, canSign: !!(signRobinhood ?? signMessage), prove };
}
