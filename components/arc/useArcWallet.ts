"use client";

/**
 * State for /wallet: the passkey session (restored silently from the stored
 * public credential), the server-side binding for the owner wallet (a Solana wallet or an EVM wallet: Arc, Robinhood
 * Chain or Base, one address), and the actions that change them. With both connected, the way in picked on /wallet
 * (useEntryMode) decides which one owns the account; Solana when none was picked. The Circle SDK loads lazily, on
 * the first restore or action.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { useSignText } from "@/components/copy/useSignText";
import { useRobinhoodWallet } from "@/components/robinhood/useRobinhoodWallet";
import { fetchBinding, fetchBindingByArc, fetchEvmBindingByArc, postBinding, postEvmBinding, type ArcBinding, type ArcEvmBinding } from "@/lib/arc/api-client";
import type { ArcSession } from "@/lib/arc/account";
import { arcBindMessage } from "@/lib/arc/bind";
import { ARC } from "@/lib/arc/config";
import { arcPublicClient } from "@/lib/arc/chain";
import { arcEvmBindMessage, fundedSession } from "@/lib/arc/evm";
import { loadArcAccount } from "@/lib/arc/lazy";
import { readWalletFunding, signWithEvm, useEvmWallet } from "./useEvmWallet";

/** The way in on /wallet: a Solana wallet, or an EVM wallet (Arc, Robinhood Chain, Base). */
export type EntryMode = "solana" | "evm";
const MODE_KEY = "mimir:entry-mode";
let modePref: EntryMode | null | undefined;
const modeListeners = new Set<() => void>();

function readModePref(): EntryMode | null {
  if (modePref !== undefined) return modePref;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(MODE_KEY);
  } catch {
    /* storage blocked */
  }
  // "arc" is the older name of the EVM way in.
  modePref = saved === "solana" ? "solana" : saved === "evm" || saved === "arc" ? "evm" : null;
  return modePref;
}

/** Remember the way in picked on /wallet, for every useArcWallet in this browser. */
export function setEntryMode(m: EntryMode) {
  modePref = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* storage blocked: not remembered */
  }
  modeListeners.forEach((l) => l());
}

/** The remembered way in, or null when none was picked. */
export const useEntryMode = () =>
  useSyncExternalStore(
    (l) => {
      modeListeners.add(l);
      return () => modeListeners.delete(l);
    },
    readModePref,
    () => null,
  );

export type BindingState = { status: "unknown" } | { status: "loaded"; binding: ArcBinding | null } | { status: "error"; error: string };

export interface ArcWallet {
  configured: boolean;
  /** The owner wallet (lib/owner.ts): the Solana key or the EVM address, per the way in (useEntryMode). */
  solana: string | null;
  /** The connected Solana wallet, whether or not it is the owner. */
  solanaWallet: string | null;
  ownerKind: "solana" | "robinhood" | null;
  session: ArcSession | null;
  restoring: boolean;
  binding: BindingState;
  /** The session's account is the one bound to the connected Solana wallet. */
  linked: boolean;
  /** The Solana wallet the session's account is bound to (null: none, undefined: not known yet). */
  sessionOwner: string | null | undefined;
  /** The EVM wallet connected in this browser (signed in for Arc, or the live connection), and the one the session's account draws from. */
  evm: `0x${string}` | null;
  evmBinding: ArcEvmBinding | null | undefined;
  /** The session's account is bound to the connected Arc wallet. */
  evmLinked: boolean;
  busy: string | null;
  error: string | null;
  clearError(): void;
  create(): Promise<ArcSession | null>;
  login(): Promise<void>;
  link(): Promise<void>;
  /** Bind the session's account to the connected Arc wallet: one wallet signature, one passkey signature. */
  linkEvm(): Promise<void>;
  recover(phrase: string): Promise<void>;
  signOut(): Promise<void>;
  /** Forget this device's passkey account and create a new one (for a second Solana wallet on the same device). */
  startFresh(): Promise<void>;
  setSession(session: ArcSession): void;
}

const passkeyName = (solana: string | null) => `mimir-${(solana ?? "user").slice(0, 6)}-${Date.now().toString(36)}`;

/** WebAuthn's NotAllowedError is the user closing the prompt: say so plainly. */
function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; shortMessage?: string; cause?: { name?: string } };
  if (e?.name === "NotAllowedError" || e?.cause?.name === "NotAllowedError") return "The passkey prompt was closed or timed out.";
  if (/User rejected|rejected the request/i.test(e?.message ?? "")) return "The request was cancelled in the wallet.";
  return e?.shortMessage ?? e?.message ?? "Something went wrong.";
}

export function useArcWallet(): ArcWallet {
  const { publicKey } = useWallet();
  const robinhood = useRobinhoodWallet();
  const pref = useEntryMode();
  const solanaKey = publicKey?.toBase58() ?? null;
  // The EVM wallet owns the account when it is the only one connected, or when it is the way in picked on /wallet.
  const evmOwner = Boolean(robinhood.address && (!solanaKey || pref === "evm"));
  const solana = evmOwner ? robinhood.address : solanaKey;
  const ownerKind = evmOwner ? "robinhood" : solanaKey ? "solana" : null;
  const signSolana = useSignText();
  const sign = evmOwner ? robinhood.sign : solanaKey ? signSolana : null;
  const configured = Boolean(ARC.circle.clientKey);
  const [session, setSession] = useState<ArcSession | null>(null);
  const [restoring, setRestoring] = useState(configured);
  const [binding, setBinding] = useState<BindingState>({ status: "unknown" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionOwner, setSessionOwner] = useState<string | null | undefined>(undefined);
  // Signed in for Arc (with a wallet proof), or else just connected: one ConnectKit account either way.
  const evm = useEvmWallet().address ?? robinhood.address;
  const [evmBinding, setEvmBinding] = useState<ArcEvmBinding | null | undefined>(undefined);

  // A stored public credential: rebuild the session without a prompt.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    loadArcAccount()
      .then(async (mod) => {
        const stored = mod.loadStoredPasskey();
        if (!stored) return;
        const s = await mod.openSession(stored);
        if (!cancelled) setSession(s);
      })
      .catch((err) => console.warn("[arc] could not restore the passkey session:", err))
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configured]);

  const reloadBinding = useCallback(async () => {
    if (!solana) return setBinding({ status: "unknown" });
    try {
      setBinding({ status: "loaded", binding: await fetchBinding(solana) });
    } catch (err) {
      setBinding({ status: "error", error: describe(err) });
    }
  }, [solana]);

  useEffect(() => {
    void reloadBinding();
  }, [reloadBinding]);

  // Which wallet owns the session's account, so a second wallet on this device is offered a new account, not a link that fails.
  const sessionAddress = session?.address ?? null;
  useEffect(() => {
    setSessionOwner(undefined);
    if (!sessionAddress) return;
    let cancelled = false;
    fetchBindingByArc(sessionAddress)
      .then((b) => !cancelled && setSessionOwner(b?.solana ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionAddress, binding]);

  // The Arc wallet the account is bound to (native sign-in): stakes draw on it when the account runs short.
  useEffect(() => {
    setEvmBinding(undefined);
    if (!sessionAddress) return;
    let cancelled = false;
    fetchEvmBindingByArc(sessionAddress)
      .then((b) => !cancelled && setEvmBinding(b))
      .catch(() => !cancelled && setEvmBinding(null));
    return () => {
      cancelled = true;
    };
  }, [sessionAddress]);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(describe(err));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const linkSession = useCallback(
    async (s: ArcSession) => {
      if (!solana || !sign) throw new Error("Connect a wallet that can sign messages.");
      const signedAt = Date.now();
      const message = arcBindMessage(solana, s.address, signedAt);
      const solanaSignature = await sign(message);
      const arcSignature = await s.signMessage(message);
      const b = await postBinding({ solana, arc: s.address, signedAt, solanaSignature, arcSignature, credentialId: s.passkey.id });
      setBinding({ status: "loaded", binding: b });
    },
    [solana, sign],
  );

  /**
   * Right after a passkey is made or opened, link it in the same flow, so nobody has to find a separate step. Skipped
   * when no wallet can sign, or when the account already has an owner (this wallet: nothing to do; another wallet: the
   * page offers a new account instead).
   */
  const linkAfter = useCallback(
    async (s: ArcSession) => {
      if (!solana || !sign) return;
      const owner = await fetchBindingByArc(s.address).catch(() => undefined);
      if (owner === undefined || owner) {
        if (owner?.solana === solana) setBinding({ status: "loaded", binding: owner });
        return;
      }
      setBusy("link");
      await linkSession(s);
    },
    [solana, sign, linkSession],
  );

  const create = useCallback(
    () =>
      run("create", async () => {
        const s = await (await loadArcAccount()).createPasskeyAccount(passkeyName(solana));
        setSession(s);
        await linkAfter(s);
        return s;
      }),
    [run, solana, linkAfter],
  );

  const login = useCallback(async () => {
    await run("login", async () => {
      const s = await (await loadArcAccount()).loginPasskeyAccount();
      setSession(s);
      await linkAfter(s);
    });
  }, [run, linkAfter]);

  const link = useCallback(async () => {
    await run("link", async () => {
      if (!session) throw new Error("Create or log in to your Arc account first.");
      await linkSession(session);
    });
  }, [run, session, linkSession]);

  const linkEvm = useCallback(async () => {
    await run("link", async () => {
      if (!evm) throw new Error("Connect your EVM wallet first.");
      if (!session) throw new Error("Create or log in to your passkey account first.");
      const signedAt = Date.now();
      const message = arcEvmBindMessage(evm, session.address, signedAt);
      const evmSignature = await signWithEvm(evm, message);
      const arcSignature = await session.signMessage(message);
      setEvmBinding(await postEvmBinding({ evm, arc: session.address, signedAt, evmSignature, arcSignature, credentialId: session.passkey.id }));
    });
  }, [run, evm, session]);

  const recover = useCallback(
    async (phrase: string) => {
      await run("recover", async () => setSession(await (await loadArcAccount()).recoverWithPhrase(phrase, passkeyName(solana))));
    },
    [run, solana],
  );

  const signOut = useCallback(async () => {
    (await loadArcAccount()).clearStoredPasskey();
    setSession(null);
  }, []);

  const startFresh = useCallback(async () => {
    await run("create", async () => {
      const mod = await loadArcAccount();
      mod.clearStoredPasskey();
      setSession(null);
      const s = await mod.createPasskeyAccount(passkeyName(solana));
      setSession(s);
      await linkAfter(s);
    });
  }, [run, solana, linkAfter]);

  // Bound to an Arc wallet: every user operation tops the account up from it (within the spending cap) when short.
  const fundedFrom = session && evmBinding?.arc === session.address ? evmBinding.evm : null;
  const funded = useMemo(() => {
    if (!session || !fundedFrom) return session;
    return fundedSession(session, fundedFrom, async () => {
      const [accountWei, f] = await Promise.all([arcPublicClient().getBalance({ address: session.address }), readWalletFunding(fundedFrom, session.address)]);
      return { accountWei, ...f };
    });
  }, [session, fundedFrom]);

  const bound = binding.status === "loaded" ? binding.binding : null;
  return {
    configured,
    solana,
    solanaWallet: solanaKey,
    ownerKind,
    session: funded,
    restoring,
    binding,
    linked: Boolean(session && bound && bound.arc.toLowerCase() === session.address.toLowerCase()),
    sessionOwner,
    evm,
    evmBinding,
    evmLinked: Boolean(evm && session && evmBinding && evmBinding.evm === evm && evmBinding.arc === session.address),
    busy,
    error,
    clearError: () => setError(null),
    create,
    login,
    link,
    linkEvm,
    recover,
    signOut,
    startFresh,
    setSession,
  };
}
