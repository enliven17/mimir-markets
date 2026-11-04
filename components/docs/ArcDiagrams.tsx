import type { CSSProperties, ReactNode } from "react";
function Node({
  tag,
  title,
  sub,
}: {
  tag: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="df-node">
      <span className="df-tag">{tag}</span>
      <span className="df-title">{title}</span>
      <span className="df-sub">{sub}</span>
    </div>
  );
}
function Flow({ label }: { label: string }) {
  return (
    <div className="df-link" aria-hidden>
      <div className="df-link-line">
        <span className="df-dot" />
      </div>
      <span className="df-link-label">{label}</span>
    </div>
  );
}
export function Figure({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 grid gap-4 rounded-2xl bg-[rgb(16_10_11/.6)] p-4 shadow-well sm:p-6">
      <div role="img" aria-label={label} className="min-w-0">
        {children}
      </div>
      <figcaption className="text-[13px] leading-relaxed text-muted">
        {caption}
      </figcaption>
    </figure>
  );
}
export function SystemDiagram() {
  return (
    <Figure
      label="A Solana wallet signs native instructions. The Mimir program escrows test USDC and settles outcomes. Convex indexes state and runs AI workers; the app reads live queries."
      caption="Personal transactions require your wallet's approval. The blockchain program enforces escrow, settlement and withdrawal rules."
    >
      <div className="grid gap-0 md:grid-cols-[1fr_64px_1fr_64px_1fr] md:items-center">
        <Node
          tag="Solana Devnet"
          title="Your wallet"
          sub="Phantom, Solflare, Backpack. Test USDC and devnet SOL."
        />
        <Flow label="sign" />
        <Node
          tag="Native program"
          title="Mimir VS"
          sub="Escrow, deadlines, disputes and payouts. Optional delegated execution."
        />
        <Flow label="chain state" />
        <Node
          tag="Convex"
          title="Index and AI workers"
          sub="Oracle, council, creator and agents. Live queries power the app."
        />
      </div>
    </Figure>
  );
}
const STEPS = [
  ["Open", "The full stake enters program escrow."],
  ["Staking closes", "60 seconds before the deadline."],
  ["Oracle proposes", "Validated evidence and a committed audit bundle."],
  ["Dispute window", "A participant contests with a 2 test USDC bond."],
  ["Final", "Finalize the proposal or apply the arbiter's ruling."],
  ["Paid", "Native instructions send eligible principal and profit."],
];
export function LifecycleDiagram() {
  return (
    <Figure
      label={`Market lifecycle: ${STEPS.map((s) => s[0]).join(", ")}.`}
      caption="Each market freezes its dispute and grace periods. Unresolved markets can be refunded under the program's lifecycle rules."
    >
      <ol className="df-steps m-0 list-none p-0">
        {STEPS.map(([title, body], i) => (
          <li
            key={title}
            className="df-step"
            style={{ "--i": i } as CSSProperties}
          >
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
export function FeeDiagram() {
  return (
    <Figure
      label="A 100 test USDC stake enters escrow in full. On 20 profit, a 0.5 percent platform fee is 0.10 and an applicable 0.5 percent owner fee is 0.10. Net payout is 119.80."
      caption="Illustration with 0.5% platform and 0.5% agent owner profit fees. Actual fees follow each market's frozen policy; self-paid fee legs are waived."
    >
      <div className="grid gap-0 md:grid-cols-[1fr_64px_1fr_64px_1fr] md:items-center">
        <Node
          tag="Stake"
          title="100.00 test USDC"
          sub="100.00 enters escrow. No entry fee."
        />
        <Flow label="win" />
        <Node
          tag="Gross payout"
          title="120.00 test USDC"
          sub="100.00 principal + 20.00 profit. Fees touch profit only."
        />
        <Flow label="0.20 fees" />
        <Node
          tag="Net payout"
          title="119.80 test USDC"
          sub="Principal is protected from fees. Refunds have no profit fee."
        />
      </div>
    </Figure>
  );
}
