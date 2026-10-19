"use client";

/**
 * State for /wallet: the passkey session (restored silently from the stored
 * public credential), the server-side binding for the connected owner
 * wallet (Solana, or else a Robinhood Chain wallet), and the actions that change them. The Circle SDK loads lazily, on
 * the first restore or action.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { useSignText } from "@/components/copy/useSignText";
import { useRobinhoodWallet } from "@/components/robinhood/useRobinhoodWallet";
import { fetchBinding, fetchBindingByArc, postBinding, type ArcBinding } from "@/lib/arc/api-client";
import type { ArcSession } from "@/lib/arc/account";
import { arcBindMessage } from "@/lib/arc/bind";
import { ARC } from "@/lib/arc/config";
import { loadArcAccount } from "@/lib/arc/lazy";

export type BindingState = { status: "unknown" } | { status: "loaded"; binding: ArcBinding | null } | { status: "error"; error: string };

export interface ArcWallet {
  configured: boolean;
  /** The owner wallet: the Solana key, or else the Robinhood Chain address (lib/owner.ts). */
  solana: string | null;
  ownerKind: "solana" | "robinhood" | null;
  session: ArcSession | null;
  restoring: boolean;
  binding: BindingState;
  /** The session's account is the one bound to the connected Solana wallet. */
  linked: boolean;
  /** The Solana wallet the session's account is bound to (null: none, undefined: not known yet). */
  sessionOwner: string | null | undefined;
  busy: string | null;
  error: string | null;
  clearError(): void;
  create(): Promise<ArcSession | null>;
  login(): Promise<void>;
  link(): Promise<void>;
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
  const solanaKey = publicKey?.toBase58() ?? null;
  const solana = solanaKey ?? robinhood.address;
  const ownerKind = solanaKey ? "solana" : robinhood.address ? "robinhood" : null;
  const signSolana = useSignText();
  const sign = solanaKey ? signSolana : robinhood.sign;
  const configured = Boolean(ARC.circle.clientKey);
  const [session, setSession] = useState<ArcSession | null>(null);
  const [restoring, setRestoring] = useState(configured);
  const [binding, setBinding] = useState<BindingState>({ status: "unknown" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionOwner, setSessionOwner] = useState<string | null | undefined>(undefined);

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

  const bound = binding.status === "loaded" ? binding.binding : null;
  return {
    configured,
    solana,
    ownerKind,
    session,
    restoring,
    binding,
    linked: Boolean(session && bound && bound.arc.toLowerCase() === session.address.toLowerCase()),
    sessionOwner,
    busy,
    error,
    clearError: () => setError(null),
    create,
    login,
    link,
    recover,
    signOut,
    startFresh,
    setSession,
  };
}
