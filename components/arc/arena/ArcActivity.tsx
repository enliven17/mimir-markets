"use client";

/**
 * Every transaction on an Arc market, newest first, each linked to ArcScan:
 * opening, stakes and challenges, the oracle's proposal, disputes, settlement
 * and payouts. Plus the oracle's verdict with its audit bundle, whose hash is
 * the evidenceHash written on chain. Transparency is the point: nothing here
 * comes from anywhere but the chain and the oracle's published record.
 */
import { useState } from "react";

import type { Doc } from "@/convex/_generated/dataModel";
import { arcExplorerUrl } from "@/lib/arc/config";
import { usdFine, type ArcMarket } from "./shared";

type Event = Doc<"arcEvents">;
type Verdict = Doc<"arcVerdicts">;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function sideName(m: ArcMarket, side?: number) {
  if (side === 1) return m.labelA;
  if (side === 2) return m.labelB;
  if (side === 3) return "Draw";
  if (side === 4) return "Unresolvable (refund)";
  return "-";
}

function label(m: ArcMarket, e: Event): string {
  const side = sideName(m, e.side);
  switch (e.name) {
    case "ClaimCreated":
    case "MarketCreated":
      return "Opened the market";
    case "Staked":
      return `Staked on ${side}`;
    case "ClaimChallenged":
      return `Challenged (${m.labelB})`;
    case "ResolutionProposed":
      return `Oracle proposed: ${side}`;
    case "ResolutionDisputed":
      return "Disputed the result (bond)";
    case "DisputeResolved":
      return `Arbiter ruled: ${side}`;
    case "ClaimResolved":
    case "MarketResolved":
      return `Settled: ${side}`;
    case "MarketSettled":
      return "Paid out to the winners";
    case "Claimed":
      return "Payout";
    case "ClaimCancelled":
      return "Cancelled, stake returned";
    case "ClaimExpiredRefund":
    case "MarketExpiredRefund":
      return "Refunded (not settled in time)";
    case "FeeAccrued":
      return "Fee";
    default:
      return e.name;
  }
}

const when = (at?: number) => (at ? new Date(at * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "");

export default function ArcActivity({ m, events, verdict }: { m: ArcMarket; events: Event[]; verdict: Verdict | null }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="On-chain activity" className="grid gap-4">
      {verdict ? (
        <div className="grid gap-3 rounded-xl bg-panel p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0 text-[14px] text-cream">Oracle verdict</h3>
            <a href={arcExplorerUrl("tx", verdict.txHash)} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-coral hover:underline">
              {short(verdict.txHash)} ↗
            </a>
          </div>
          <p className="m-0 text-[14px] leading-relaxed text-cream">
            <span className="text-win">{sideName(m, verdict.side)}</span> · {verdict.confidence}% confidence
          </p>
          <p className="m-0 text-[13px] leading-relaxed text-muted">{verdict.summary}</p>
          <p className="m-0 break-all font-mono text-[11px] text-dim">evidence hash {verdict.evidenceHash}</p>
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-fit text-[12px] text-coral hover:underline">
            {open ? "Hide" : "Show"} the audit bundle (sources, prices, model, adjustments)
          </button>
          {open ? (
            <pre data-lenis-prevent className="m-0 max-h-[360px] overflow-auto rounded-lg bg-ink-deep p-3 font-mono text-[11px] leading-relaxed text-muted">
              {JSON.stringify(JSON.parse(verdict.bundle), null, 2)}
            </pre>
          ) : null}
          <p className="m-0 text-[11px] text-dim">
            The hash on chain is the sha256 of this bundle in canonical form (lib/verdict-bundle.ts), so anyone can check the oracle did not change its
            reasons after the fact.
          </p>
        </div>
      ) : null}

      <ol className="m-0 grid list-none gap-0 p-0">
        {events.map((e) => (
          <li key={e._id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-line py-2.5 text-[13px] last:border-0">
            <span className="truncate text-cream">{label(m, e)}</span>
            <a href={arcExplorerUrl("tx", e.txHash)} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-coral hover:underline">
              {short(e.txHash)} ↗
            </a>
            <span className="truncate text-[12px] text-muted">
              {e.user ? (
                <a href={arcExplorerUrl("address", e.user)} target="_blank" rel="noreferrer" className="font-mono hover:text-cream">
                  {short(e.user)}
                </a>
              ) : null}
              {e.amount && e.amount !== "0" ? <span className="ml-2 text-cream">{usdFine(e.amount)}</span> : null}
            </span>
            <span className="text-right text-[12px] text-dim">{when(e.at)}</span>
          </li>
        ))}
      </ol>
      {events.length === 0 ? <p className="m-0 text-[13px] text-muted">No transactions indexed yet.</p> : null}
    </section>
  );
}
