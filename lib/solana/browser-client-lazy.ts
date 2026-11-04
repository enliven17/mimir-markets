"use client";

/**
 * Code-split front door to lib/solana/browser-client. That module pulls Anchor,
 * the program IDL and SPL Token, which cost a noticeable chunk of startup
 * script evaluation on every page that merely *could* send a transaction.
 * Through this file they load the first time a wallet is connected (the
 * `useBrowserMimir` hook) or an action runs, never on a plain page view.
 *
 * Same names and signatures as browser-client; import types from there.
 */
import { useEffect, useState } from "react";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type * as Client from "./browser-client";
import type { BrowserMimir } from "./browser-client";

type ClientModule = typeof Client;

let pending: Promise<ClientModule> | null = null;
/** Load (once) and return the full browser client. */
export function loadBrowserClient(): Promise<ClientModule> {
  pending ??= import("./browser-client");
  return pending;
}

type AsyncKeys = {
  [K in keyof ClientModule]: ClientModule[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof ClientModule];

function lazy<K extends AsyncKeys>(name: K): ClientModule[K] {
  return (async (...args: unknown[]) => {
    const mod = await loadBrowserClient();
    return (mod[name] as (...a: unknown[]) => Promise<unknown>)(...args);
  }) as ClientModule[K];
}

export const depositUsdc = lazy("depositUsdc");
export const withdrawUsdc = lazy("withdrawUsdc");
export const delegateBalance = lazy("delegateBalance");
export const undelegateBalance = lazy("undelegateBalance");
export const challengeInER = lazy("challengeInER");
export const createClaim = lazy("createClaim");
export const delegateClaim = lazy("delegateClaim");
export const disputeResolution = lazy("disputeResolution");
export const finalizeResolution = lazy("finalizeResolution");
export const refundExpired = lazy("refundExpired");
export const undelegateClaim = lazy("undelegateClaim");
export const getVirtualBalance = lazy("getVirtualBalance");
export const payoutCreator = lazy("payoutCreator");
export const payoutChallenger = lazy("payoutChallenger");
export const refundBond = lazy("refundBond");
export const refundExpiredFromAnywhere = lazy("refundExpiredFromAnywhere");
export const withdrawAllBalance = lazy("withdrawAllBalance");

/**
 * The Anchor programs for the connected wallet, or null while disconnected
 * (and for the moment the client chunk is loading after a connect).
 */
export function useBrowserMimir(wallet: WalletContextState): BrowserMimir | null {
  const [mimir, setMimir] = useState<BrowserMimir | null>(null);
  const { publicKey, signTransaction } = wallet;

  useEffect(() => {
    if (!publicKey || !signTransaction) {
      setMimir(null);
      return;
    }
    let cancelled = false;
    loadBrowserClient()
      .then((mod) => {
        if (!cancelled) setMimir(mod.createBrowserMimir(wallet));
      })
      .catch((error) => console.error("Browser client failed to load:", error));
    return () => {
      cancelled = true;
    };
    // Rebuilt for a new key or signer only, like the useMemo it replaces.
  }, [publicKey, signTransaction]);

  return mimir;
}
