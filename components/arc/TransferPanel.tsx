"use client";

/**
 * Deposit (Solana → Arc) and withdraw (Arc → Solana) over Circle's CCTP, plus
 * transfers left half-done (burned, not yet received) with a Finish button.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import Segmented from "@/components/ui/Segmented";
import { fetchAttestation, fetchDepositFeeBps } from "@/lib/arc/api-client";
import type { ArcSession } from "@/lib/arc/account";
import { formatUsdcUnits, parseUsdcAmount } from "@/lib/arc/encoding";
import { loadArcTransfers } from "@/lib/arc/lazy";
import type { PendingTransfer, TransferDeps, TransferKind, TransferProgress } from "@/lib/arc/transfers";
import TransferSteps from "./TransferSteps";

interface Props {
  session: ArcSession;
  arcUnits: bigint | null;
  solanaUnits: bigint | null;
  onSettled: () => void;
}

function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; shortMessage?: string };
  if (e?.name === "NotAllowedError") return "The passkey prompt was closed or timed out.";
  if (/User rejected|rejected the request/i.test(e?.message ?? "")) return "The request was cancelled in the wallet.";
  return e?.shortMessage ?? e?.message ?? "The transfer failed.";
}

export default function TransferPanel({ session, arcUnits, solanaUnits, onSettled }: Props) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const amountId = useId();
  const [kind, setKind] = useState<TransferKind>("deposit");
  const [amount, setAmount] = useState("");
  const [feeBps, setFeeBps] = useState<number | null>(null);
  const [active, setActive] = useState<{ kind: TransferKind; progress: TransferProgress } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTransfer[]>([]);

  const reloadPending = useCallback(() => {
    void loadArcTransfers().then((m) => setPending(m.loadPendingTransfers()));
  }, []);

  useEffect(() => {
    reloadPending();
    fetchDepositFeeBps().then(setFeeBps, () => setFeeBps(null));
  }, [reloadPending]);

  const units = parseUsdcAmount(amount);
  const available = kind === "deposit" ? solanaUnits : arcUnits;
  const tooMuch = units !== null && available !== null && units > available;
  const signer = publicKey && signTransaction ? { publicKey, signTransaction } : null;

  async function go(fn: (m: Awaited<ReturnType<typeof loadArcTransfers>>, deps: TransferDeps) => Promise<unknown>, k: TransferKind) {
    setBusy(true);
    setError(null);
    setActive({ kind: k, progress: { step: "signing" } });
    try {
      const m = await loadArcTransfers();
      await fn(m, { attestation: fetchAttestation, onProgress: (progress) => setActive({ kind: k, progress }) });
      setAmount("");
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
      reloadPending();
      onSettled();
    }
  }

  function submit() {
    if (!signer || units === null || tooMuch) return;
    if (kind === "deposit") {
      if (feeBps === null) return setError("The transfer fee quote is not available yet; try again in a moment.");
      void go((m, deps) => m.deposit({ connection, signer, session, amount: units, feeBps }, deps), "deposit");
    } else {
      void go((m, deps) => m.withdraw({ connection, signer, session, amount: units }, deps), "withdraw");
    }
  }

  function finish(p: PendingTransfer) {
    if (!signer) return;
    void go(
      (m, deps) =>
        p.kind === "deposit" ? m.finishDeposit({ tx: p.tx, session }, deps) : m.finishWithdraw({ tx: p.tx, connection, signer }, deps),
      p.kind,
    );
  }

  return (
    <div className="grid gap-4">
      <Segmented<TransferKind>
        as="toggle"
        tone="maroon"
        size="sm"
        label="Transfer direction"
        value={kind}
        onChange={(v) => {
          setKind(v);
          setError(null);
        }}
        options={[
          { value: "deposit", label: "Deposit to Arc" },
          { value: "withdraw", label: "Withdraw to Solana" },
        ]}
        className="justify-self-start"
      />
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={amountId} className="text-[13px] text-muted">
          Amount (USDC)
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            id={amountId}
            inputMode="decimal"
            autoComplete="off"
            placeholder="1.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
            aria-invalid={amount !== "" && (units === null || tooMuch)}
            aria-describedby={`${amountId}-hint`}
            className="min-w-0 flex-1 rounded-xl bg-ink-deep px-3 py-2.5 font-mono text-[15px] text-cream outline-none placeholder:text-dim focus-visible:ring-2 focus-visible:ring-coral"
          />
          <button
            type="submit"
            disabled={busy || !signer || units === null || tooMuch}
            className="rounded-full bg-coral px-6 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60"
          >
            {busy ? "Working…" : kind === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        </div>
        <p id={`${amountId}-hint`} className="m-0 text-[12px] text-muted">
          {available !== null ? `Available: ${formatUsdcUnits(available)} USDC ${kind === "deposit" ? "on Solana" : "on Arc"}. ` : ""}
          {kind === "deposit"
            ? `Fast transfer through Circle's CCTP${feeBps !== null ? `, fee about ${(feeBps / 100).toFixed(2)}% of the amount` : ""}. You pay the Solana fee.`
            : "Standard transfer through Circle's CCTP, no fee. Arc gas is sponsored; receiving on Solana costs a tiny SOL fee."}
          {tooMuch ? " That is more than you have." : ""}
        </p>
      </form>

      {active ? <TransferSteps kind={active.kind} progress={active.progress} /> : null}
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-coral">
          {error}
        </p>
      ) : null}

      {pending.length ? (
        <div className="grid gap-2 border-t border-line pt-4">
          <h3 className="m-0 text-[14px] font-medium text-cream">Transfers to finish</h3>
          <p className="m-0 text-[12px] text-muted">These left one chain but have not arrived on the other yet. Finishing is safe to retry.</p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {pending.map((p) => (
              <li key={p.tx} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ink-deep px-3 py-2 text-[13px]">
                <span className="text-cream">
                  {p.amount} USDC {p.kind === "deposit" ? "to Arc" : "to Solana"}
                  <span className="ml-2 font-mono text-[11px] text-dim">{new Date(p.at).toLocaleString("en-US")}</span>
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !signer}
                    onClick={() => finish(p)}
                    className="press rounded-full bg-panel-raised px-4 py-1.5 text-[13px] text-cream disabled:opacity-60"
                  >
                    Finish
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void loadArcTransfers().then((m) => (m.forgetPendingTransfer(p.tx), reloadPending()))}
                    className="press rounded-full px-3 py-1.5 text-[13px] text-muted hover:text-cream disabled:opacity-60"
                    aria-label={`Dismiss the ${p.amount} USDC transfer (only if it already arrived)`}
                  >
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
