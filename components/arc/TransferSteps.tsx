"use client";

/**
 * The four steps of a CCTP transfer, with explorer links as they appear. The
 * current step is announced through a polite live region; the list itself is
 * static so screen readers do not re-read it on every change.
 */
import { Check, Loader2 } from "lucide-react";

import type { TransferKind, TransferProgress, TransferStep } from "@/lib/arc/transfers";

const ORDER: TransferStep[] = ["signing", "attesting", "receiving", "done"];

const LABELS: Record<TransferKind, Record<TransferStep, string>> = {
  deposit: {
    signing: "Sign the transfer in your Solana wallet",
    attesting: "Circle confirms the transfer (about 15 seconds)",
    receiving: "Your Arc account receives the USDC (passkey prompt, no gas)",
    done: "Done: the USDC is in your Arc account",
  },
  withdraw: {
    signing: "Approve with your passkey (no gas)",
    attesting: "Circle confirms the transfer (about 30 seconds)",
    receiving: "Your Solana wallet signs to receive it (a tiny SOL fee)",
    done: "Done: the USDC is in your Solana wallet",
  },
};

export default function TransferSteps({ kind, progress }: { kind: TransferKind; progress: TransferProgress }) {
  const current = ORDER.indexOf(progress.step);
  return (
    <div className="grid gap-3" data-transfer-kind={kind} data-transfer-step={progress.step}>
      <p aria-live="polite" className="sr-only">
        {LABELS[kind][progress.step]}
      </p>
      <ol className="m-0 grid list-none gap-2 p-0">
        {ORDER.map((step, i) => {
          const state = i < current || progress.step === "done" ? "done" : i === current ? "active" : "todo";
          return (
            <li key={step} className="flex items-start gap-3 text-[14px]" aria-current={state === "active" ? "step" : undefined}>
              <span
                aria-hidden
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  state === "done" ? "bg-coral text-[#160909]" : state === "active" ? "bg-panel-raised text-cream" : "bg-ink-deep text-dim"
                }`}
              >
                {state === "done" ? <Check size={12} /> : state === "active" ? <Loader2 size={12} className="animate-spin" /> : null}
              </span>
              <span className={state === "todo" ? "text-dim" : "text-cream"}>
                {LABELS[kind][step]}
                <span className="sr-only">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {progress.sourceUrl || progress.destUrl ? (
        <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
          {progress.sourceUrl ? (
            <a href={progress.sourceUrl} target="_blank" rel="noreferrer" className="text-muted underline underline-offset-2 hover:text-cream">
              {kind === "deposit" ? "Solana transaction" : "Arc transaction"}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          {progress.destUrl ? (
            <a href={progress.destUrl} target="_blank" rel="noreferrer" className="text-muted underline underline-offset-2 hover:text-cream">
              {kind === "deposit" ? "Arc transaction" : "Solana transaction"}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
