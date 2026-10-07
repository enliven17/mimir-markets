/**
 * The /docs diagrams: HTML boxes with CSS-only motion (components/docs/docs.css), so they stay crisp, reflow to one
 * column on phones and need no client JavaScript. Each figure carries a text alternative for screen readers.
 */
import type { CSSProperties, ReactNode } from "react";

function Node({ tag, title, sub, hot }: { tag: string; title: string; sub?: ReactNode; hot?: boolean }) {
  return (
    <div className="df-node" data-hot={hot || undefined}>
      <span className="df-tag">{tag}</span>
      <span className="df-title">{title}</span>
      {sub ? <span className="df-sub">{sub}</span> : null}
    </div>
  );
}

/** A link between two nodes; `back` draws the return path (muted, flowing the other way). */
function Link({ label, back, vertical, delay = 0, className = "" }: { label?: string; back?: boolean; vertical?: boolean; delay?: number; className?: string }) {
  return (
    <div className={`df-link ${className}`} data-back={back || undefined} data-v={vertical || undefined} aria-hidden>
      <div className="df-link-line">
        <span className="df-dot" style={{ "--d": `${delay}s` } as CSSProperties} />
      </div>
      {label ? <span className="df-link-label">{label}</span> : null}
    </div>
  );
}

export function Figure({ label, caption, children }: { label: string; caption: string; children: ReactNode }) {
  return (
    <figure className="m-0 grid gap-4 rounded-2xl bg-[rgb(16_10_11/.6)] p-4 shadow-well sm:p-6">
      <div role="img" aria-label={label} className="min-w-0">
        {children}
      </div>
      <figcaption className="text-[13px] leading-relaxed text-muted">{caption}</figcaption>
    </figure>
  );
}

/** (a) The system: money in from Solana, markets on Arc, the house agents and the index on the backend, the app on top. */
export function SystemDiagram() {
  return (
    <Figure
      label="System overview. A Solana wallet sends USDC over Circle CCTP to the user's passkey account on Arc. The account stakes into the MimirV3 and MimirPool contracts. Mimir's backend indexes the contracts and runs the oracle and the council, which write back to the contracts. The web app reads the index live and sends the user's operations from the passkey account."
      caption="USDC enters from Solana over CCTP, every stake and payout happens on Arc, and Mimir's backend keeps the index, the oracle and the council running beside the contracts."
    >
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_64px_minmax(0,1.15fr)] md:items-center">
        <Node tag="Solana" title="Your wallet" sub="Phantom, Solflare, any wallet. Holds USDC and your $MIMIR." />
        <Link label="CCTP ~15 s" />
        <Node tag="Arc" title="Passkey account" sub="Face ID or fingerprint. Gas sponsored by Circle." hot />
        <Link label="stake" delay={1.1} />
        <Node tag="Arc · contracts" title="MimirV3 · MimirPool" sub="VS duels and two-sided pools. Native USDC escrow." hot />
      </div>
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_64px_minmax(0,1.15fr)]">
        <div className="max-md:hidden" />
        <div className="max-md:hidden" />
        <div className="max-md:hidden" />
        <div className="max-md:hidden" />
        <Link back vertical label="events · verdicts" delay={0.6} />
      </div>
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_88px_minmax(0,2.2fr)] md:items-center">
        <div className="max-md:order-3">
          <Node tag="Web app" title="Arena, market pages" sub="Live queries, no polling. Every tx linked to ArcScan." />
        </div>
        <Link back label="live index" delay={1.8} className="max-md:order-2" />
        <div className="df-node max-md:order-1">
          <span className="df-tag">Backend</span>
          <span className="df-title">Indexer · Oracle · Council</span>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ["Indexer", "every 30 s", "reads both contracts, keeps markets, positions and every tx"],
              ["Oracle", "every minute", "proposes, finalizes, refunds, pushes pool payouts"],
              ["Council", "every 5 min", "20 personas bet from Circle wallets"],
            ].map(([t, when, what]) => (
              <div key={t} className="grid gap-1 rounded-lg bg-[var(--panel-2)] p-2.5">
                <span className="flex items-baseline justify-between gap-2 text-[13px] text-cream">
                  {t}
                  <span className="df-pulse font-mono text-[10.5px] text-coral">{when}</span>
                </span>
                <span className="text-[12px] leading-snug text-muted">{what}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Figure>
  );
}

const STEPS: Array<[string, string]> = [
  ["Open", "Stakes come in. Each pays the entry fee; the rest is escrowed on Arc."],
  ["Betting closes", "60 s before the deadline, so no one bets on a known outcome."],
  ["Oracle proposes", "Evidence, deadline prices and the model's verdict. The audit bundle's hash goes on chain."],
  ["Dispute window", "Any participant can dispute with a 2 USDC bond; the arbiter rules."],
  ["Final", "Anyone can finalize once the window closes. Verdicts are refused after the grace period."],
  ["Paid", "Winners are paid straight to their Arc accounts. Draw or unresolvable: everyone refunded."],
];

/** (b) The market lifecycle as a stepper that lights up in order. */
export function LifecycleDiagram() {
  return (
    <Figure
      label={`Market lifecycle in six steps: ${STEPS.map(([t]) => t).join(", ")}. If no verdict lands within 7 days of the deadline, anyone can refund the market in full.`}
      caption="If no verdict lands within 7 days of the deadline (or of a dispute), anyone can call refundExpired and every stake goes back. Funds never depend on the oracle staying online."
    >
      <ol className="df-steps m-0 list-none p-0">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="df-step" style={{ "--i": i } as CSSProperties}>
            <span className="df-step-n">{String(i + 1).padStart(2, "0")}</span>
            <span className="df-step-bar">
              <i />
            </span>
            <span className="text-[14px] text-cream">{title}</span>
            <span className="text-[12px] leading-snug text-muted">{body}</span>
          </li>
        ))}
      </ol>
    </Figure>
  );
}

/** (c) Where a stake's money goes: the entry fee off the top, the net into the market, copy fees only on profit. */
export function FeeDiagram() {
  return (
    <Figure
      label="Fee flow for a 100 USDC stake. 0.50 USDC entry fee goes to the treasury (0.25 with 5 million MIMIR, 0.10 with 10 million) and 99.50 USDC goes into the market. A winning payout has no fee, except copy trades, which give 1% of the profit to the basket creator and 1% to Mimir."
      caption="Example: a $100 stake. The entry fee is the only fee on a normal bet and is kept on refunds; winnings are never charged, except the 1% + 1% of profit on copy trades."
    >
      <div className="grid gap-0 md:grid-cols-[minmax(0,0.8fr)_72px_minmax(0,1.6fr)_72px_minmax(0,1fr)] md:items-center">
        <Node tag="You send" title="$100.00" sub="from your Arc account" />
        <Link delay={0.3} />
        <div className="df-node">
          <span className="df-tag">Entry fee</span>
          <div className="mt-1 grid gap-2.5">
            {[
              ["Standard", 50, "$0.50"],
              ["5M+ $MIMIR", 25, "$0.25"],
              ["10M+ $MIMIR", 10, "$0.10"],
            ].map(([who, bps, fee]) => (
              <div key={who as string} className="grid gap-1">
                <span className="flex justify-between text-[13px]">
                  <span className="text-cream">{who}</span>
                  <span className="font-mono text-muted">
                    {(bps as number) / 100}% · {fee}
                  </span>
                </span>
                <span className="df-split">
                  <span style={{ width: `${Math.max(4, (bps as number) * 2)}%`, background: "var(--coral)" }} />
                  <span style={{ flex: 1, background: "rgb(243 234 214 / .22)" }} />
                </span>
              </div>
            ))}
          </div>
        </div>
        <Link delay={1.2} />
        <Node tag="Into the market" title="$99.50 net stake" sub="Win: stake + your share of the other side, no fee." hot />
      </div>
      <div className="grid gap-2 rounded-xl bg-[var(--panel)] p-3.5 text-[13px] sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-4">
        <span className="df-tag">Copy trades</span>
        <span className="text-muted">
          A bet copied from a basket pays <span className="text-cream">1% of its profit</span> to the basket creator and{" "}
          <span className="text-cream">1% to Mimir</span>, on wins only. Copying itself is free.
        </span>
      </div>
    </Figure>
  );
}
