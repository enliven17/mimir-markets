"use client";

/**
 * Mimir Terminal payments, the browser side:
 *   - the terminal session: one signature (no transaction) proving which wallet asks, 12 h
 *   - the `limit` block: show, approve or revoke the USDC spending limit (one transaction)
 * The USDC never leaves the user's wallet until a paid agent answers.
 */
import { useCallback, useEffect, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { createApproveCheckedInstruction, createRevokeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { useMimirWallet } from "@/hooks/useMimirWallet";
import { useSignText } from "@/components/copy/useSignText";
import { USDC_DECIMALS, USDC_MINT } from "@/lib/solana/config";
import {
  parseSessionHeader,
  terminalSessionMessage,
  TERMINAL_SESSION_HEADER,
  TERMINAL_WALLET_HEADER,
} from "@/lib/terminal/pay";
import { Cmd, Err, Note, Wave, type Run } from "./blocks";

const SESSION_KEY = "mimir.terminal.session";
/** The terminal's delegate, inlined at build time. Null: paid agents are off. */
export const TERMINAL_DELEGATE = process.env.NEXT_PUBLIC_TERMINAL_DELEGATE?.trim() || null;

function readSession(wallet: string): string | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as { wallet?: string; header?: string } | null;
    return raw?.wallet === wallet && parseSessionHeader(raw.header) ? raw.header! : null;
  } catch {
    return null;
  }
}

/** Headers for a paid request, signing a fresh session when needed (one wallet prompt per 12 h). */
export function useTerminalSession(): {
  wallet: string | null;
  headers: () => Record<string, string>;
  ensure: (fresh?: boolean) => Promise<Record<string, string>>;
} {
  const { publicKey } = useMimirWallet();
  const sign = useSignText();
  const wallet = publicKey?.toBase58() ?? null;

  const headers = useCallback((): Record<string, string> => {
    if (!wallet) return {};
    const header = readSession(wallet);
    return header ? { [TERMINAL_WALLET_HEADER]: wallet, [TERMINAL_SESSION_HEADER]: header } : {};
  }, [wallet]);

  /** `fresh`: the server refused the stored session (clock skew, expiry): sign a new one. */
  const ensure = useCallback(async (fresh = false) => {
    if (!wallet) throw new Error("connect a wallet first");
    const existing = fresh ? {} : headers();
    if (existing[TERMINAL_SESSION_HEADER]) return existing;
    if (!sign) throw new Error("this wallet cannot sign messages");
    const signedAt = Date.now();
    const signature = await sign(terminalSessionMessage(wallet, signedAt));
    const header = `${signedAt}.${signature}`;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ wallet, header }));
    } catch {
      // private mode: this request still carries it
    }
    return { [TERMINAL_WALLET_HEADER]: wallet, [TERMINAL_SESSION_HEADER]: header };
  }, [wallet, sign, headers]);

  return { wallet, headers, ensure };
}

interface LimitState {
  approvedToTerminal: boolean;
  otherDelegate: string | null;
  delegatedUsdc: number;
  balanceUsdc: number;
  owedUsdc: number;
  availableUsdc: number;
}

/** `limit` (show), `limit <usdc>` (approve), `limit revoke`. */
export function Limit({ amount, revoke, run }: { amount: number | null; revoke: boolean; run: Run }) {
  const { publicKey, sendTransaction, connection } = useMimirWallet();
  const [state, setState] = useState<LimitState | null>(null);
  const [phase, setPhase] = useState<"idle" | "signing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const wallet = publicKey?.toBase58() ?? null;

  const load = useCallback(async () => {
    if (!wallet) return;
    const res = await fetch(`/api/terminal/limit?wallet=${wallet}`);
    const body = (await res.json().catch(() => ({}))) as { data?: LimitState; error?: string };
    if (!res.ok || !body.data) throw new Error(body.error ?? "could not read the limit");
    setState(body.data);
  }, [wallet]);

  useEffect(() => {
    if (!wallet || !TERMINAL_DELEGATE) return;
    let alive = true;
    (async () => {
      try {
        if (amount !== null) {
          // approve or revoke: one transaction from the user's own wallet
          setPhase("signing");
          const owner = new PublicKey(wallet);
          const ata = getAssociatedTokenAddressSync(USDC_MINT, owner, true);
          const ix = revoke
            ? createRevokeInstruction(ata, owner)
            : createApproveCheckedInstruction(ata, USDC_MINT, new PublicKey(TERMINAL_DELEGATE!), owner, BigInt(Math.round(amount * 1e6)), USDC_DECIMALS);
          const signature = await sendTransaction(new Transaction().add(ix), connection);
          await connection.confirmTransaction(signature, "confirmed");
          if (!alive) return;
          setSig(signature);
          setPhase("done");
        }
        await load();
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message.slice(0, 200) : "cancelled");
      }
    })();
    return () => {
      alive = false;
    };
    // One action per printed block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!TERMINAL_DELEGATE) return <Note>paid agents are not switched on yet.</Note>;
  if (!wallet) return <Note>connect a wallet first (top right), then run limit again.</Note>;
  if (error) return <Err>{error}</Err>;
  if (phase === "signing") return <Wave label={revoke ? "revoking the limit, confirm in your wallet" : `approving ${amount} USDC, confirm in your wallet`} />;
  if (!state) return <Wave label="reading your limit" />;

  return (
    <div className="grid max-w-[80ch] gap-1 border-l-2 border-coral/60 pl-4">
      {phase === "done" ? (
        <div className="text-win">
          ✓ {revoke ? "limit revoked: the terminal can no longer charge this wallet" : `limit set to ${amount} USDC`}
          {sig ? <span className="text-dim"> · {sig.slice(0, 8)}…</span> : null}
        </div>
      ) : null}
      {state.approvedToTerminal ? (
        <>
          <div>
            <span className="text-dim">available </span>
            <span className="font-display text-[1.6rem] leading-none text-cream">{state.availableUsdc.toFixed(3)} USDC</span>
          </div>
          <div className="text-muted">
            limit {state.delegatedUsdc} · owed {state.owedUsdc} · wallet {state.balanceUsdc} USDC
          </div>
        </>
      ) : (
        <div className="text-muted">
          no limit for the terminal. Paid agents charge from your own wallet within a limit you approve once.{" "}
          <Cmd line="limit 5" run={run} className="text-cream">
            › limit 5
          </Cmd>
        </div>
      )}
      {state.otherDelegate && !state.approvedToTerminal ? (
        <Note>note: another app holds this USDC account&apos;s spending slot; setting a terminal limit replaces it.</Note>
      ) : null}
      <Note>the USDC stays in your wallet; 99.5% of each paid message goes to the agent&apos;s creator. limit revoke turns it off.</Note>
    </div>
  );
}
