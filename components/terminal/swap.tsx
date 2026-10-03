"use client";

/**
 * `buy <mint> <usdc>` / `sell <mint> <pct>`: a Jupiter Ultra quote, the
 * warnings worth reading, then one signature in the user's wallet. Solana
 * mainnet, real funds; the browser talks to Jupiter directly (lib/jupiter.ts).
 */
import { useEffect, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";

import { useMimirWallet } from "@/hooks/useMimirWallet";
import { MAINNET_USDC, sellAmount, swapWarnings, ultraBalance, ultraExecute, ultraOrder, type UltraOrder } from "@/lib/jupiter";
import { short } from "@/lib/terminal/format";
import { Err, Note, Wave, type Run } from "./blocks";

interface TokenMeta {
  symbol: string | null;
  decimals: number | null;
  verified: boolean | null;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  liquidityUsd: number | null;
}

const fmt = (raw: string | bigint, decimals: number | null) =>
  decimals === null ? `${raw} (raw units)` : (Number(raw) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 6 });

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

type Phase =
  | { kind: "quoting" }
  | { kind: "quote"; order: UltraOrder; token: TokenMeta | null; warnings: string[] }
  | { kind: "signing" }
  | { kind: "done"; signature: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export function Swap({ side, mint, usdc, pct }: { side: "buy" | "sell"; mint: string; usdc?: number; pct?: number; run: Run }) {
  const { publicKey, signTransaction } = useMimirWallet();
  const [phase, setPhase] = useState<Phase>({ kind: "quoting" });
  const [ack, setAck] = useState(false);
  const wallet = publicKey?.toBase58() ?? null;

  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    (async () => {
      try {
        const tokenRes = await fetch(`/api/terminal/token?mint=${mint}`).then((r) => r.json()).catch(() => null);
        const token = (tokenRes?.data ?? null) as TokenMeta | null;
        let amount: bigint;
        if (side === "buy") amount = BigInt(Math.round((usdc ?? 0) * 1e6));
        else {
          const bal = await ultraBalance(wallet, mint);
          amount = sellAmount(bal.raw, pct ?? 0);
          if (amount <= 0n) throw new Error(`this wallet holds no ${token?.symbol ?? short(mint)} on mainnet`);
        }
        const order = await ultraOrder({
          inputMint: side === "buy" ? MAINNET_USDC : mint,
          outputMint: side === "buy" ? mint : MAINNET_USDC,
          amount,
          taker: wallet,
        });
        if (!order.transaction) throw new Error("Jupiter has no route for this amount (or the wallet lacks the funds)");
        if (alive) setPhase({ kind: "quote", order, token, warnings: swapWarnings(order, token) });
      } catch (err) {
        if (alive) setPhase({ kind: "error", message: err instanceof Error ? err.message.slice(0, 200) : "no quote" });
      }
    })();
    return () => {
      alive = false;
    };
    // One quote per printed block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  async function confirm(order: UltraOrder) {
    if (!signTransaction || !publicKey) return;
    setPhase({ kind: "signing" });
    try {
      const tx = VersionedTransaction.deserialize(fromBase64(order.transaction!));
      // Never sign a swap someone else would pay for or own.
      if (!tx.message.staticAccountKeys[0]?.equals(publicKey)) throw new Error("the quote is not for this wallet");
      const signed = await signTransaction(tx);
      const res = await ultraExecute(toBase64(signed.serialize()), order.requestId);
      if (res.status !== "Success" || !res.signature) throw new Error(res.error ?? "the swap did not land");
      setPhase({ kind: "done", signature: res.signature });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message.slice(0, 200) : "cancelled" });
    }
  }

  if (!wallet) return <Note>connect a wallet first (top right), then run it again.</Note>;
  if (phase.kind === "quoting") return <Wave label={`quoting ${side} on Jupiter`} />;
  if (phase.kind === "signing") return <Wave label="confirm in your wallet" />;
  if (phase.kind === "error") return <Err>{phase.message}</Err>;
  if (phase.kind === "cancelled") return <Note>cancelled. Nothing was signed.</Note>;
  if (phase.kind === "done") {
    return (
      <div className="text-win">
        ✓ swap landed ·{" "}
        <a href={`https://solscan.io/tx/${phase.signature}`} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
          {phase.signature.slice(0, 10)}… ↗
        </a>
      </div>
    );
  }

  const { order, token, warnings } = phase;
  const sym = token?.symbol ? `$${token.symbol}` : short(mint);
  const pay = side === "buy" ? `${fmt(order.inAmount, 6)} USDC` : `${fmt(order.inAmount, token?.decimals ?? null)} ${sym}`;
  const get = side === "buy" ? `${fmt(order.outAmount, token?.decimals ?? null)} ${sym}` : `${fmt(order.outAmount, 6)} USDC`;
  const impact = Math.abs(Number(order.priceImpactPct ?? 0)) * 100;
  const route = (order.routePlan ?? []).map((r) => r.swapInfo?.label).filter(Boolean).join(" → ");
  const risky = warnings.length > 0;

  return (
    <div className="grid max-w-[80ch] gap-1.5 border-l-2 border-coral/60 pl-4">
      <div className="text-dim">{side} · Solana mainnet · real funds · via Jupiter</div>
      <div className="font-display text-[1.6rem] leading-tight text-cream">
        {pay} <span className="text-coral">→</span> {get}
      </div>
      <div className="text-muted">
        price impact {impact.toFixed(2)}% · fee {(order.feeBps ?? 0) / 100}%{route ? ` · ${route}` : ""}
      </div>
      {warnings.map((w) => (
        <div key={w} className="text-danger">
          ⚠ {w}
        </div>
      ))}
      {risky ? (
        <label className="flex items-center gap-2 text-muted">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="accent-red" />
          I read the warnings
        </label>
      ) : null}
      <div className="mt-1 flex gap-3">
        <button
          type="button"
          disabled={risky && !ack}
          onClick={() => confirm(order)}
          className="rounded-full bg-coral px-5 py-1.5 text-[13px] font-medium text-[#160909] disabled:opacity-40"
        >
          sign {side}
        </button>
        <button type="button" onClick={() => setPhase({ kind: "cancelled" })} className="rounded-full border border-line-strong px-5 py-1.5 text-[13px] text-cream">
          cancel
        </button>
      </div>
      <Note>quotes move fast: sign within a few seconds or run it again.</Note>
    </div>
  );
}
