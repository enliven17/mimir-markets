"use client";

/**
 * State for /wallet: the passkey session (restored silently from the stored
 * public credential), the server-side binding for the connected Solana
 * wallet, and the actions that change them. The Circle SDK loads lazily, on
 * the first restore or action.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { useSignText } from "@/components/copy/useSignText";
import { fetchBinding, postBinding, type ArcBinding } from "@/lib/arc/api-client";
import type { ArcSession } from "@/lib/arc/account";
import { arcBindMessage } from "@/lib/arc/bind";
import { ARC } from "@/lib/arc/config";
import { loadArcAccount } from "@/lib/arc/lazy";

export type BindingState = { status: "unknown" } | { status: "loaded"; binding: ArcBinding | null } | { status: "error"; error: string };

export interface ArcWallet {
  configured: boolean;
  solana: string | null;
  session: ArcSession | null;
  restoring: boolean;
  binding: BindingState;
  /** The session's account is the one bound to the connected Solana wallet. */
  linked: boolean;
  busy: string | null;
  error: string | null;
  clearError(): void;
  create(): Promise<ArcSession | null>;
  login(): Promise<void>;
  link(): Promise<void>;
  recover(phrase: string): Promise<void>;
  signOut(): Promise<void>;
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
  const solana = publicKey?.toBase58() ?? null;
  const sign = useSignText();
  const configured = Boolean(ARC.circle.clientKey);
  const [session, setSession] = useState<ArcSession | null>(null);
  const [restoring, setRestoring] = useState(configured);
  const [binding, setBinding] = useState<BindingState>({ status: "unknown" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const create = useCallback(
    () =>
      run("create", async () => {
        const s = await (await loadArcAccount()).createPasskeyAccount(passkeyName(solana));
        setSession(s);
        return s;
      }),
    [run, solana],
  );

  const login = useCallback(async () => {
    await run("login", async () => setSession(await (await loadArcAccount()).loginPasskeyAccount()));
  }, [run]);

  const link = useCallback(async () => {
    await run("link", async () => {
      if (!solana || !sign) throw new Error("Connect a Solana wallet that can sign messages.");
      if (!session) throw new Error("Create or log in to your Arc account first.");
      const signedAt = Date.now();
      const message = arcBindMessage(solana, session.address, signedAt);
      const solanaSignature = await sign(message);
      const arcSignature = await session.signMessage(message);
      const b = await postBinding({ solana, arc: session.address, signedAt, solanaSignature, arcSignature, credentialId: session.passkey.id });
      setBinding({ status: "loaded", binding: b });
    });
  }, [run, solana, sign, session]);

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

  const bound = binding.status === "loaded" ? binding.binding : null;
  return {
    configured,
    solana,
    session,
    restoring,
    binding,
    linked: Boolean(session && bound && bound.arc.toLowerCase() === session.address.toLowerCase()),
    busy,
    error,
    clearError: () => setError(null),
    create,
    login,
    link,
    recover,
    signOut,
    setSession,
  };
}
