"use client";

/** An agent's token and two wallets, as labelled cards: the full address, a copy button and where to look it up. */
import { useState } from "react";

import { ExternalMark } from "@/components/ExternalMark";
import { arcExplorerUrl } from "@/lib/arc/config";
import { argusTokenUrl } from "@/lib/launch/argus";
import { pumpFun, rhExplorer, rhToken, solscan } from "@/lib/launch/council-view";

type Row = { label: string; note: string; address: string; href: string; site: string; tone: string };

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy address"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="shrink-0 rounded-full bg-cream/[0.06] px-3 py-1.5 text-[12px] text-cream transition-colors hover:bg-cream/15"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export default function WalletsBlock({ ticker, mint, argus = null, solana, robinhood = null, arc, venue = "solana" }: {
  ticker: string; mint: string | null; argus?: string | null; solana: string | null; robinhood?: string | null; arc: string | null; venue?: string;
}) {
  // `mint` is the token on the agent's own launchpad: Pons for a Robinhood agent, else pump.fun.
  const rh = venue === "robinhood";
  const rows: Row[] = [
    mint && rh ? { label: `$${ticker} token`, note: "Its own coin on Pons (Robinhood Chain)", address: mint, href: rhToken(mint), site: "Pons", tone: "bg-[#86efac]" } : null,
    mint && !rh ? { label: `$${ticker} token`, note: "Its own coin on pump.fun", address: mint, href: pumpFun(mint), site: "pump.fun", tone: "bg-[#86efac]" } : null,
    argus ? { label: `$${ticker} on Argus`, note: "Its USDC token on Arc", address: argus, href: argusTokenUrl(argus), site: "Argus", tone: "bg-[#a78bfa]" } : null,
    solana ? { label: "Solana wallet", note: "Trades and pays its SOL gas", address: solana, href: solscan("account", solana), site: "Solscan", tone: "bg-[#14f195]" } : null,
    robinhood ? { label: "Robinhood Chain wallet", note: "Trades on Pons and pays its ETH gas", address: robinhood, href: rhExplorer("address", robinhood), site: "Blockscout", tone: "bg-[#ccff00]" } : null,
    arc ? { label: "Arc wallet", note: "Stakes USDC on Mimir markets", address: arc, href: arcExplorerUrl("address", arc), site: "Arc explorer", tone: "bg-coral" } : null,
  ].filter((r): r is Row => r !== null);
  if (!rows.length) return null;
  return (
    <section aria-label="Token and wallets" className={`grid gap-3 sm:grid-cols-2 ${rows.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      {rows.map((r) => (
        <div key={r.label} className="grid content-start gap-2.5 rounded-2xl bg-[rgb(27_19_20/.93)] p-4 shadow-[inset_0_0_0_1px_rgb(243_234_214/.07)]">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${r.tone}`} aria-hidden />
            <span className="text-[14px] text-cream">{r.label}</span>
          </div>
          <p className="m-0 text-[12px] text-muted">{r.note}</p>
          <p className="m-0 break-all rounded-xl bg-ink-deep px-3 py-2 font-mono text-[12px] leading-relaxed text-cream">{r.address}</p>
          <div className="flex items-center justify-between gap-2">
            <a href={r.href} target="_blank" rel="noreferrer" className="text-[13px] text-coral hover:underline">
              Open on {r.site} <ExternalMark />
            </a>
            <CopyButton text={r.address} />
          </div>
        </div>
      ))}
    </section>
  );
}
