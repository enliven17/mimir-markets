"use client";

/**
 * The connected wallet's token tier (from /api/token/tier) and its stored
 * holder proof. The proof is a per-browser convenience in localStorage: it
 * only lets the council APIs count this wallet at its tier, and expires in 24h.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

import {
  HOLDER_PROOF_HEADER,
  HOLDER_WALLET_HEADER,
  formatProofHeader,
  holderProofMessage,
  parseProofHeader,
} from "@/lib/token-proof";
import type { TokenBalances, TokenTier } from "@/lib/token-tiers";

export interface TierState {
  tier: TokenTier;
  balances: TokenBalances;
  launched: boolean;
  symbol: string;
}

const proofKey = (wallet: string) => `mimir.holder-proof.${wallet}`;

function readProof(wallet: string): string | null {
  try {
    const v = localStorage.getItem(proofKey(wallet));
    return v && parseProofHeader(v) ? v : null;
  } catch {
    return null;
  }
}

/** Headers carrying the connected wallet's holder proof, or {} when there is none. */
export function holderProofHeaders(wallet: string | null | undefined): Record<string, string> {
  if (!wallet) return {};
  const proof = readProof(wallet);
  return proof ? { [HOLDER_WALLET_HEADER]: wallet, [HOLDER_PROOF_HEADER]: proof } : {};
}

// One request per wallet per page load, shared by the header chip and the page.
const inflight = new Map<string, Promise<TierState | null>>();

function loadTier(wallet: string): Promise<TierState | null> {
  let p = inflight.get(wallet);
  if (!p) {
    p = fetch(`/api/token/tier?wallet=${encodeURIComponent(wallet)}`)
      .then(async (res) => (res.ok ? (((await res.json()) as { data?: TierState }).data ?? null) : null))
      .catch(() => null);
    inflight.set(wallet, p);
    p.then((v) => {
      if (v === null) inflight.delete(wallet);
    });
  }
  return p;
}

export function useHolderTier() {
  const { publicKey, signMessage } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [state, setState] = useState<TierState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [proven, setProven] = useState(false);

  useEffect(() => {
    setState(null);
    setLoaded(false);
    setProven(wallet ? readProof(wallet) !== null : false);
    if (!wallet) return;
    let live = true;
    loadTier(wallet).then((v) => {
      if (!live) return;
      setState(v);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [wallet]);

  const prove = useCallback(async () => {
    if (!wallet || !signMessage) throw new Error("this wallet cannot sign messages");
    const signedAt = Date.now();
    const sig = bs58.encode(await signMessage(new TextEncoder().encode(holderProofMessage(wallet, signedAt))));
    try {
      localStorage.setItem(proofKey(wallet), formatProofHeader(signedAt, sig));
    } catch {
      /* storage blocked: the proof just is not remembered */
    }
    setProven(true);
  }, [wallet, signMessage]);

  return { wallet, state, loaded, proven, canSign: !!signMessage, prove };
}
