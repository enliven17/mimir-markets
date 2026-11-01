"use client";

/**
 * The connected wallet's stored wallet proof (lib/wallet-proof.ts). The proof is a per-browser convenience in
 * localStorage: it lets routes that act for a wallet (follows, access, invite codes) know it is this one, and expires
 * in 24h.
 */
import { useCallback, useEffect, useState } from "react";

import { useMimirWallet } from "@/hooks/useMimirWallet";
import { WALLET_PROOF_HEADER, WALLET_HEADER, formatProofHeader, walletProofMessage, parseProofHeader } from "@/lib/wallet-proof";

const proofKey = (wallet: string) => `mimir.wallet-proof.${wallet}`;

function readProof(wallet: string): string | null {
  try {
    const v = localStorage.getItem(proofKey(wallet));
    return v && parseProofHeader(v) ? v : null;
  } catch {
    return null;
  }
}

/** Headers carrying the wallet's proof, or {} when there is none. */
export function walletProofHeaders(wallet: string | null | undefined): Record<string, string> {
  if (!wallet) return {};
  const proof = readProof(wallet);
  return proof ? { [WALLET_HEADER]: wallet, [WALLET_PROOF_HEADER]: proof } : {};
}

export function useWalletProof() {
  const { address: wallet, signMessage } = useMimirWallet();
  const [proven, setProven] = useState(false);

  useEffect(() => {
    const syncProof = () => setProven(wallet ? readProof(wallet) !== null : false);
    syncProof();
    window.addEventListener("mimir-wallet-proof", syncProof);
    return () => window.removeEventListener("mimir-wallet-proof", syncProof);
  }, [wallet]);

  const prove = useCallback(async () => {
    if (!wallet || !signMessage) throw new Error("Connect your wallet first.");
    const signedAt = Date.now();
    const sig = await signMessage(walletProofMessage(wallet, signedAt));
    try {
      localStorage.setItem(proofKey(wallet), formatProofHeader(signedAt, sig));
    } catch {
      /* storage blocked: the proof just is not remembered */
    }
    setProven(true);
    window.dispatchEvent(new Event("mimir-wallet-proof"));
  }, [wallet, signMessage]);

  return { wallet, proven, canSign: Boolean(signMessage), prove };
}
