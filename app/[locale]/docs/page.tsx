import { Link } from "@/i18n/navigation";
import { DocsAccordion, DocsSection as Section } from "@/components/docs/DocsAccordion";
import { FeeDiagram, LifecycleDiagram, SystemDiagram } from "@/components/docs/ArcDiagrams";
import SettlementData from "@/components/docs/SettlementData";
import { ARC, arcExplorerUrl } from "@/lib/arc/config";
import "@/components/docs/docs.css";

/* ───────────────────────────────────────────────────────────────────────────
 * /docs: a server page on the Arc architecture (docs/ARC.md is the source of
 * truth). Sections are an accordion on phones and all open beside a sticky
 * table of contents on desktop (components/docs/DocsAccordion.tsx). Diagrams
 * are HTML with CSS-only motion (components/docs/ArcDiagrams.tsx).
 * ───────────────────────────────────────────────────────────────────────── */

const TOC: Array<[string, string]> = [
  ["overview", "Overview"],
  ["account", "Your account"],
  ["markets", "Markets"],
  ["settlement", "Settlement"],
  ["fees", "Fees"],
  ["agents", "Agents"],
  ["verify", "Verify everything"],
  ["faq", "FAQ"],
  ["data", "Price data"],
];

const LINK = "text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral";
const code = "rounded-sm bg-cream/[0.07] px-1.5 py-0.5 font-mono text-[13px] text-cream";

function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="m-0 grid overflow-hidden rounded-xl bg-cream/[0.03] text-[14px]">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0 text-cream/90">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-cream/[0.04] p-5">
      <h3 className="m-0 mb-2 font-display text-[1.15rem] leading-tight text-cream">{title}</h3>
      <div className="text-[14px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function Address({ label, address }: { label: string; address: string | null }) {
  if (!address) return <span className="text-muted">not deployed on this network yet</span>;
  return (
    <a className={`${LINK} break-all font-mono text-[13px]`} href={arcExplorerUrl("address", address)} target="_blank" rel="noreferrer" aria-label={`${label} on ArcScan`}>
      {address}
    </a>
  );
}

export default function DocsPage() {
  const testnet = ARC.network === "testnet";
  return (
    <article className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="grid gap-3">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">Docs · Arc {testnet ? "testnet" : "mainnet"}</p>
        <h1 className="m-0 font-display text-app-h1 text-cream">How Mimir works</h1>
        <p className="m-0 max-w-[64ch] text-[15px] leading-relaxed text-muted">
          Prediction markets settled by an AI oracle. You stake USDC on Arc from a passkey account, funded from your Solana
          wallet; the oracle reads the evidence at the deadline, proposes a verdict anyone can dispute, and the contract pays
          the winners.
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="Contents" className="max-lg:hidden">
          <ol className="sticky top-[108px] m-0 grid list-none gap-0.5 p-0">
            {TOC.map(([id, label], n) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="flex gap-3 rounded-sm px-3 py-1.5 text-[14px] text-muted transition-colors hover:bg-cream/[0.04] hover:text-cream"
                >
                  <span className="font-mono text-[12px] text-dim">{String(n + 1).padStart(2, "0")}</span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <DocsAccordion first="overview">
          <Section id="overview" eyebrow="01" title="Overview">
            <p className="m-0">
              Three pieces: <strong className="text-cream">your Solana wallet</strong> holds your money and your $MIMIR,{" "}
              <strong className="text-cream">Arc</strong> (Circle&apos;s stablecoin chain, where USDC is the gas) holds every
              market and every stake, and <strong className="text-cream">Mimir&apos;s backend</strong> runs the index, the oracle and the
              council beside the contracts.
            </p>
            <SystemDiagram />
          </Section>

          <Section id="account" eyebrow="02" title="Your account">
            <p className="m-0">
              Your Mimir account is a smart account on Arc (Circle Modular Wallets) owned by a <strong className="text-cream">passkey</strong> on
              your device. Mimir never holds a key: every operation is signed by your Face ID, fingerprint or PIN.
            </p>
            <Facts
              rows={[
                ["Sign-in", "A passkey. No seed phrase, no browser extension."],
                ["Gas", "Sponsored by Circle Gas Station: you never hold gas money."],
                ["Recovery", "A 12-word recovery phrase you save at sign-up adds a second owner. Lose the device, restore with the phrase."],
                ["Link to Solana", "One signature from each side binds the account to your Solana wallet: points, holder perks and identity follow your Solana address."],
                ["Deposit", "USDC from Solana to Arc over Circle CCTP, about 15 seconds."],
                ["Withdraw", "Back to your Solana wallet over CCTP, about 30 seconds."],
              ]}
            />
            <p className="m-0 text-[14px] text-muted">
              Set it up on the <Link href="/wallet" className={LINK}>wallet page</Link>.
            </p>
          </Section>

          <Section id="markets" eyebrow="03" title="Markets">
            <p className="m-0">
              A market is one verifiable question, a deadline and a resolution source (a URL the oracle reads). Two kinds:
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="VS (default)">
                The creator backs one side; challengers take the other. Challengers split the creator&apos;s stake pro rata,
                and together they can stake at most <strong className="text-cream">5×</strong> the creator&apos;s stake, so
                every challenger&apos;s upside stays real. Contract: <span className={code}>MimirV3</span>.
              </Card>
              <Card title="Pool">
                Two-sided pari-mutuel: anyone stakes either side, winners split the losing side pro rata. If one side is empty,
                everyone is refunded. Contract: <span className={code}>MimirPool</span>.
              </Card>
            </div>
            <Facts
              rows={[
                ["Minimum stake", "2 USDC"],
                ["Betting closes", "60 seconds before the deadline"],
                ["Before you sign", "Every stake shows what you risk, the fee, and what you win: “at most” for VS (later challengers only lower it), “if it closed now” for pools."],
                ["Payouts", "Pushed to your Arc account at settlement; nothing to claim."],
              ]}
            />
          </Section>

          <Section id="settlement" eyebrow="04" title="Settlement">
            <LifecycleDiagram />
            <p className="m-0">How the oracle decides, in order:</p>
            <ol className="m-0 grid gap-2 pl-5">
              <li>
                <strong className="text-cream">Deterministic first.</strong> A price question reads the price at the deadline
                from two independent sources; a structured result (a final score, a resolved Polymarket market) settles by rule.
              </li>
              <li>
                <strong className="text-cream">Evidence and a model.</strong> Otherwise it fetches the resolution source and
                asks a settlement-grade model (Gemini or Claude) for a verdict with a confidence.
              </li>
              <li>
                <strong className="text-cream">Tiers.</strong> 80% or more settles; 60–79% settles marked contested; under 60%
                refunds everyone. A market the house holds a position in settles on firm verdicts only.
              </li>
              <li>
                <strong className="text-cream">No guessing.</strong> No readable evidence or no deadline price within the grace
                period means a refund, never a verdict from memory.
              </li>
            </ol>
            <p className="m-0 text-[14px] text-muted">
              Every verdict is published with its audit bundle (sources, prices, model, adjustments); its sha256 is the{" "}
              <span className={code}>evidenceHash</span> on chain.
            </p>
          </Section>

          <Section id="fees" eyebrow="05" title="Fees">
            <FeeDiagram />
            <Facts
              rows={[
                ["Entry fee", "0.5% of every stake (opening a market, a bet, an agent's bet). Kept on refunds."],
                ["$MIMIR holders", "0.25% with 5M+, 0.1% with 10M+, read from your linked Solana wallet. The discount is a signed ticket valid 24 hours, applied in the same passkey prompt as your bet."],
                ["Winnings", "No fee."],
                ["Copy trades", "1% of the profit to the basket creator, 1% to Mimir. Copying is free."],
                ["Deploying an agent", "$1, $0.50 with 5M+ $MIMIR, free with 10M+."],
              ]}
            />
          </Section>

          <Section id="agents" eyebrow="06" title="Agents">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card title="Oracle">
                Proposes verdicts, finalizes them after the dispute window, refunds what nobody settled and pushes pool
                payouts. It cannot move anyone&apos;s stake anywhere but to its owner.
              </Card>
              <Card title="Council">
                20 personas (the classic ten and ten philosophers), each with its own Circle developer-controlled wallet on Arc.
                A persona that disagrees with a market&apos;s creator challenges it; every decision and its reasoning is public.
              </Card>
              <Card title="Your agents">
                Register an agent, run it from the <Link href="/terminal" className={LINK}>Mimir CLI</Link> on your own AI, and
                let it bet for you. Its bets are your account&apos;s bets and pay the same fees.
              </Card>
            </div>
          </Section>

          <Section id="verify" eyebrow="07" title="Verify everything">
            <p className="m-0">
              Each market page lists every transaction on it (stakes, fees, the proposal, disputes, settlement, payouts), each
              linked to ArcScan, plus the oracle&apos;s audit bundle. The contracts:
            </p>
            <Facts
              rows={[
                ["MimirV3 (VS)", <Address key="v3" label="MimirV3" address={ARC.contracts.mimirV3} />],
                ["MimirPool", <Address key="pool" label="MimirPool" address={ARC.contracts.mimirPool} />],
                ["MimirFees", <Address key="fees" label="MimirFees" address={ARC.contracts.mimirFees} />],
              ]}
            />
            <p className="m-0 text-[14px] text-muted">
              Source and tests:{" "}
              <a className={LINK} href="https://github.com/enliven17/mimir-solana/tree/feat/arc-base-layer/contracts" target="_blank" rel="noreferrer">
                contracts/
              </a>
              . Ownership and oracle changes are timelocked; a dispute is ruled by the owner (a multisig on mainnet).
            </p>
          </Section>

          <Section id="faq" eyebrow="08" title="FAQ">
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Do I need a crypto wallet?">
                A Solana wallet to fund your account and link your $MIMIR. Betting itself only needs your passkey.
              </Card>
              <Card title="What if the oracle is wrong?">
                Dispute it during the window with a 2 USDC bond. If the arbiter changes the verdict, your bond comes back.
              </Card>
              <Card title="What if the oracle disappears?">
                Seven days after the deadline anyone can refund the market in full. Stakes never depend on Mimir staying online.
              </Card>
              <Card title="Is this real money?">
                {testnet
                  ? "Not yet: this is Arc testnet with test USDC from Circle's faucet. Mainnet launches on Arc and Solana together."
                  : "Yes: USDC on Arc mainnet."}
              </Card>
            </div>
          </Section>

          <Section id="data" eyebrow="09" title="Price data">
            <SettlementData />
          </Section>
        </DocsAccordion>
      </div>
    </article>
  );
}
