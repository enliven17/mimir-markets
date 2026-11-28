/**
 * The /docs diagrams: HTML boxes with CSS-only motion (components/docs/docs.css), so they stay crisp, reflow to one
 * column on phones and need no client JavaScript. Each figure carries a text alternative for screen readers.
 * (The file keeps its historical name; the diagrams take the default market chain as props.)
 */
import type { CSSProperties, ReactNode } from "react";

export interface ChainCopy {
  /** "BNB Smart Chain", "BSC Testnet", "Base", ... */
  name: string;
  /** Gas token symbol: "BNB", "ETH", "USDC". */
  gas: string;
  /** "BscScan", "BaseScan", ... */
  explorer: string;
}

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

/** (a) The system: the user's wallet, the market contracts, the backend (indexer, oracle, council), the app on top. */
export function SystemDiagram({ chain }: { chain: ChainCopy }) {
  return (
    <Figure
      label={`System overview. The user's EVM wallet holds USDC on ${chain.name} and stakes straight into the MimirV3Erc20 and MimirPoolErc20 contracts, paying gas in ${chain.gas}. Mimir's backend indexes the contracts and runs the oracle, which proposes verdicts back to the contracts. Sentinels re-check every proposal. The web app reads the index and sends each transaction from the user's wallet.`}
      caption={`USDC stays in your wallet until you stake. Every stake, proposal, dispute and payout is a transaction on ${chain.name}. The backend only indexes and proposes; it holds no user funds.`}
    >
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_64px_minmax(0,1.15fr)] md:items-center">
        <Node tag="You" title="Your EVM wallet" sub="MetaMask, Rabby, any injected or WalletConnect wallet." />
        <Link label="approve" />
        <Node tag={chain.name} title="Your USDC" sub={`Stake in USDC, gas in ${chain.gas}. Exact-amount approvals.`} hot />
        <Link label="stake" delay={1.1} />
        <Node tag="Contracts" title="MimirV3Erc20 · MimirPoolErc20" sub="VS duels and two-sided pools. USDC escrow, no proxy." hot />
      </div>
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_64px_minmax(0,1.15fr)]">
        <div className="max-md:hidden" />
        <div className="max-md:hidden" />
        <div className="max-md:hidden" />
        <div className="max-md:hidden" />
        <Link back vertical label="events · proposals" delay={0.6} />
      </div>
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_88px_minmax(0,2.2fr)] md:items-center">
        <div className="max-md:order-3">
          <Node tag="Web app" title="Arena, market pages" sub={`Every transaction linked to ${chain.explorer}.`} />
        </div>
        <Link back label="index" delay={1.8} className="max-md:order-2" />
        <div className="df-node max-md:order-1">
          <span className="df-tag">Off chain</span>
          <span className="df-title">Indexer · Oracle · Sentinels</span>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ["Indexer", "every 30 s", "reads both contracts: markets, positions, every transaction"],
              ["Oracle", "every 2 min", "decides, commits a Proof-of-Reasoning root, proposes, finalizes"],
              ["Sentinels", "anyone", "re-verify each proposal; Agent ID holders can dispute it"],
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
  ["Open", "Stakes come in. Each pays the entry fee (0% with an Agent ID); the rest is escrowed."],
  ["Staking closes", "60 s before the deadline, or earlier at a set lock (kickoff)."],
  ["Oracle proposes", "Side, confidence and the Proof-of-Reasoning root, in one transaction."],
  ["Dispute window", "At least 24 h on mainnet. A participant or a Sentinel disputes with a 2 USDC bond."],
  ["Final", "Undisputed: anyone finalizes. Disputed: the arbiter rules."],
  ["Paid", "VS pushes payouts; pool payouts are claimed or pushed. Draw or unresolvable: refunds."],
];

/** (b) The market lifecycle as a stepper that lights up in order. */
export function LifecycleDiagram() {
  return (
    <Figure
      label={`Market lifecycle in six steps: ${STEPS.map(([t]) => t).join(", ")}. If no verdict lands within 7 days of the deadline, anyone can refund the market in full.`}
      caption="If nothing settles within 7 days of the deadline (or of the proposal or dispute, whichever is later), anyone can call refundExpired. Funds never depend on the oracle staying online."
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
      label="Fee flow for a 100 USDC stake. 0.50 USDC entry fee goes to the fee recipient and 99.50 USDC goes into the market. An Agent ID holder pays no entry fee. A winning payout has no fee, except copy trades, which give 1% of the profit to the basket creator and 1% to Mimir."
      caption="Example: a 100 USDC stake. The entry fee is the only fee on a normal stake and is kept on refunds. Winnings are never charged, except 1% + 1% of profit on copy trades."
    >
      <div className="grid gap-0 md:grid-cols-[minmax(0,0.8fr)_72px_minmax(0,1.6fr)_72px_minmax(0,1fr)] md:items-center">
        <Node tag="You send" title="100.00 USDC" sub="one approval, one transaction" />
        <Link delay={0.3} />
        <Node tag="Entry fee" title="0.50 USDC" sub="0.5% to the fee recipient. 0 with an Agent ID. Kept on refunds." />
        <Link delay={1.2} />
        <Node tag="Into the market" title="99.50 USDC net stake" sub="Win: stake + your share of the other side, no fee." hot />
      </div>
      <div className="grid gap-2 rounded-xl bg-[var(--panel)] p-3.5 text-[13px] sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-4">
        <span className="df-tag">Copy trades</span>
        <span className="text-muted">
          A copied stake pays <span className="text-cream">1% of its profit</span> to the basket creator and{" "}
          <span className="text-cream">1% to Mimir</span>, on wins only. Copying itself is free.
        </span>
      </div>
    </Figure>
  );
}
