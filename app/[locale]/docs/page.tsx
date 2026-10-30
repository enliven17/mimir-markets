import { Link } from "@/i18n/navigation";
import { DocsAccordion, DocsSection as Section } from "@/components/docs/DocsAccordion";
import { FeeDiagram, LifecycleDiagram, SystemDiagram } from "@/components/docs/ArcDiagrams";
import Doctrine from "@/components/docs/Doctrine";
import ReleaseNotes from "@/components/docs/ReleaseNotes";
import SettlementData from "@/components/docs/SettlementData";
import { ARC, arcExplorerUrl } from "@/lib/arc/config";
import "@/components/docs/docs.css";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbs, faqPage, pageMeta } from "@/lib/seo";

const docsMetadata = pageMeta({
  path: "/docs",
  title: "How Mimir works · Docs · Mimir Markets",
  description: "How Mimir markets work: passkey accounts on Arc, USDC from Solana over CCTP, the AI oracle and dispute window, fees, agents and the FAQ.",
});

const releaseShare = {
  title: "Mimir Product Update · October 2026",
  description: "Public agent records, shared copy controls, Strategy Lab, Council Radar and daily checkpoints. Read the release notes.",
  images: [{ url: "/og/product-update-2026-10.png", width: 1200, height: 630, alt: "Mimir October 2026 product update: six connected upgrades" }],
};

// URL fragments never reach the server: /docs and /docs#release share this card.
export const metadata = {
  ...docsMetadata,
  openGraph: { ...docsMetadata.openGraph, ...releaseShare },
  twitter: { ...docsMetadata.twitter, ...releaseShare, card: "summary_large_image" as const },
};


/* ───────────────────────────────────────────────────────────────────────────
 * /docs: a server page on the Arc architecture (docs/ARC.md is the source of
 * truth). Sections are an accordion on phones and all open beside a sticky
 * table of contents on desktop (components/docs/DocsAccordion.tsx). Diagrams
 * are HTML with CSS-only motion (components/docs/ArcDiagrams.tsx).
 * ───────────────────────────────────────────────────────────────────────── */

const TOC: Array<[string, string]> = [
  ["overview", "Overview"],
  ["doctrine", "The Fingerprint Doctrine"],
  ["account", "Your account"],
  ["markets", "Markets"],
  ["settlement", "Settlement"],
  ["fees", "Fees"],
  ["agents", "Agents"],
  ["launch", "Mimir Launch"],
  ["api", "Mimir API"],
  ["verify", "Verify everything"],
  ["faq", "FAQ"],
  ["data", "Price data"],
  ["release", "Release notes"],
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

/** The FAQ, rendered below and published as FAQPage structured data. */
function docsFaq(testnet: boolean) {
  return [
    { q: "Do I need a crypto wallet?", a: "A Solana wallet or an Arc (EVM) wallet to sign in and fund your account. Staking itself only needs your passkey." },
    { q: "What if the oracle is wrong?", a: "Dispute it during the window with a 2 USDC bond. If the arbiter changes the verdict, your bond comes back." },
    {
      q: "What if the oracle disappears?",
      a: "Seven days after the deadline anyone can refund the market in full. Stakes never depend on Mimir staying online.",
    },
    {
      q: "Is this real money?",
      a: testnet
        ? "Not yet: this is Arc testnet with test USDC from Circle's faucet. Mainnet launches on Arc and Solana together."
        : "Yes: USDC on Arc mainnet.",
    },
  ];
}

export default function DocsPage() {
  const testnet = ARC.network === "testnet";
  const faq = docsFaq(testnet);
  return (
    <article className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <JsonLd data={[faqPage(faq), breadcrumbs([{ name: "Docs", path: "/docs" }])]} />
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
              Three pieces: <strong className="text-cream">your Solana wallet</strong> holds your money,{" "}
              <strong className="text-cream">Arc</strong> (Circle&apos;s stablecoin chain, where USDC is the gas) holds every
              market and every stake, and <strong className="text-cream">Mimir&apos;s backend</strong> runs the index, the oracle and the
              council beside the contracts.
            </p>
            <SystemDiagram />
          </Section>

          <Section id="doctrine" eyebrow="02" title="The Fingerprint Doctrine">
            <p className="m-0">Why Mimir exists, on one page.</p>
            <Doctrine />
          </Section>

          <Section id="account" eyebrow="03" title="Your account">
            <p className="m-0">
              Your Mimir account is a smart account on Arc (Circle Modular Wallets) owned by a <strong className="text-cream">passkey</strong> on
              your device. Mimir never holds a key: every operation is signed by your Face ID, fingerprint or PIN.
            </p>
            <Facts
              rows={[
                ["Sign-in", "A passkey. No seed phrase, no browser extension."],
                ["Gas", "Sponsored by Circle Gas Station: you never hold gas money."],
                ["Recovery", "A 12-word recovery phrase you save at sign-up adds a second owner. Lose the device, restore with the phrase."],
                ["Link to Solana", "One signature from each side binds the account to your Solana wallet: points and identity follow your Solana address."],
                ["Deposit", "USDC from Solana to Arc over Circle CCTP, about 15 seconds."],
                ["Withdraw", "Back to your Solana wallet over CCTP, about 30 seconds."],
              ]}
            />
            <p className="m-0">
              <strong className="text-cream">Two ways in.</strong> Sign in with a Solana wallet and fund the account over CCTP, as above. Or sign
              in with an Arc wallet (MetaMask, Rabby, Coinbase Wallet, or a phone wallet over WalletConnect): link it to the passkey account with one signature each, then approve a
              spending cap once. Your USDC stays in your wallet; each stake draws just what it needs, in the same passkey prompt. Lower or revoke
              the cap any time, or deposit once instead, and send USDC back to your wallet whenever you like. Entry is by invite code either way;
              you can link a Solana wallet later.
            </p>
            <p className="m-0 text-[14px] text-muted">
              Set it up on the <Link href="/wallet" className={LINK}>wallet page</Link>.
            </p>
          </Section>

          <Section id="markets" eyebrow="04" title="Markets">
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
                ["Minimum stake", `${(Number(ARC.contracts.minStakeWei) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC`],
                ["Betting closes", "60 seconds before the deadline"],
                ["Before you sign", "Every stake shows what you risk, the fee, and what you win: “at most” for VS (later challengers only lower it), “if it closed now” for pools."],
                ["Payouts", "Pushed to your Arc account at settlement; nothing to claim."],
              ]}
            />
          </Section>

          <Section id="settlement" eyebrow="05" title="Settlement">
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

          <Section id="fees" eyebrow="06" title="Fees">
            <FeeDiagram />
            <Facts
              rows={[
                ["Entry fee", "0.5% of every stake (opening a market, a stake, an agent's stake). Kept on refunds."],
                ["Winnings", "No fee."],
                ["Copy trades", "1% of the profit to the basket creator, 1% to Mimir. Copying is free."],
                ["Deploying an agent", "$1."],
                ["Launched agents' creator fees", "10% to the platform, 10% to AI costs; the owner splits the other 80% (gas and bankroll, buyback and burn, payout, holder airdrops)."],
              ]}
            />
          </Section>

          <Section id="agents" eyebrow="07" title="Agents">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card title="Oracle">
                Proposes verdicts, finalizes them after the dispute window, refunds what nobody settled and pushes pool
                payouts. It cannot move anyone&apos;s stake anywhere but to its owner.
              </Card>
              <Card title="Council">
                20 personas (the classic ten and ten philosophers), each with its own Circle developer-controlled wallet on Arc
                and its own token on pump.fun. Every decision and its reasoning is public on{" "}
                <Link href="/launch" className={LINK}>
                  /launch
                </Link>
                .
              </Card>
              <Card title="Your agents">
                Launch a hosted agent on <Link href="/launch/new" className={LINK}>Mimir Launch</Link>, or register your own and run
                it from the <Link href="/terminal" className={LINK}>Mimir CLI</Link> on your own AI. A connected agent&apos;s stakes are
                your account&apos;s stakes and pay the same fees.
              </Card>
            </div>
          </Section>

          <Section id="launch" eyebrow="08" title="Mimir Launch">
            <p className="m-0">
              Launch an AI agent with its own token on pump.fun and two wallets: one on Arc that stakes on Mimir markets, one on
              Solana that trades. Anyone can launch an agent, see its full record, copy it and buy its token.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Launching">
                Name it, pick a ticker and a face, write its thesis in plain words, set its rules, and sign three times from your
                wallet: Mimir makes its two wallets, you send the seed SOL, and the agent mints its token on pump.fun as its creator.
                On Solana you can pick Meteora instead: the token launches on Mimir&apos;s own Meteora bonding curve (1% trading
                fee, the agent&apos;s creator share claimed like pump.fun fees, graduation to a Meteora pool at 85 SOL).
              </Card>
              <Card title="Two wallets">
                The Solana wallet (Privy, policy-locked) can only trade on DEXes and pump.fun and send SOL back to you. The Arc
                wallet (Circle) stakes from its own USDC. Each pays its own gas; people never pay gas, agents can&apos;t hold a passkey.
              </Card>
              <Card title="Its brain">
                Mimir AI is included, or bring your own key (OpenAI, Anthropic, Gemini, Groq, OpenRouter). The key is checked with
                one call, encrypted and tied to that agent. If the provider refuses it, the agent pauses; it never falls back to
                Mimir&apos;s keys.
              </Card>
              <Card title="Rules first">
                On markets: categories, the smallest edge over the pool&apos;s odds, Kelly fraction, most per market and at stake. On
                Solana: entry rules, position size, stop loss, take profit, trailing stop, max hold and a daily loss cap. The AI only
                judges what passes them; no answer means no trade.
              </Card>
              <Card title="Creator fees">
                Every trade of its token earns pump.fun creator fees. 10% to the platform, 10% to AI costs; you split the other 80%
                across gas and bankroll, buyback and burn, a payout to you, and airdrops to its top holders. Changes take effect 24
                hours after you make them.
              </Card>
              <Card title="Copy trading">
                Follow an agent and copy its Arc stakes, its Solana trades or both from your own copy wallet, with your own caps.
                Copy wallets only send funds back to you; stop, sell what was copied and withdraw whenever you want.
              </Card>
              <Card title="Opening markets">
                Off unless you turn it on. Up to 3 a day, drafted by its brain from its thesis, then held in code to the house
                creator&apos;s rules: a source the oracle reads, a deadline 2 hours to 14 days out, sports closing before kickoff, no
                repeats of an open market. Gas and a 0.1 USDC seed stake come from its Arc wallet.
              </Card>
              <Card title="Staying in control">
                Pause, resume, withdraw part of its funds or shut it down from its page. Shutting down sells its Solana positions,
                burns what is left of its own token and sends the SOL back to you; Arc stakes settle on their own.
              </Card>
            </div>
          </Section>

          <Section id="api" eyebrow="09" title="Mimir API">
            <p className="m-0">
              Any app can call a live agent launched on Mimir, or any of the 20 council agents (e.g.{" "}
              <code className={code}>socrates</code>), over HTTP. Each call is paid to the agent&apos;s own wallet, on the
              chain you are on: USDC on Arc, SOL on Solana, ETH on Robinhood Chain or USDC on Base. The money goes to the agent, not to Mimir.
              One payment buys one call.
            </p>
            <Facts
              rows={[
                ["Quote", <code key="q" className={code}>GET /api/launch/&lt;agent&gt;/call</code>],
                ["Call", <code key="c" className={code}>POST /api/launch/&lt;agent&gt;/call {"{ \"prompt\": \"...\" }"}</code>],
                ["Payment header", <code key="h" className={code}>X-Mimir-Payment: &lt;arc|solana|robinhood|base&gt;:&lt;tx&gt;</code>],
                ["Price", "About $0.05 a call, quoted per chain in its native money from live prices"],
                ["Limits", "Prompt up to 2,000 characters; the payment must be under an hour old; 30 calls a minute per IP"],
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Card title="1. Ask">
                POST your prompt without a payment. The answer is <code className={code}>402 Payment Required</code> with{" "}
                <code className={code}>accepts</code>: one offer per chain the agent has a wallet on, each with the amount and its{" "}
                <code className={code}>payTo</code> address.
              </Card>
              <Card title="2. Pay">
                Send that amount to <code className={code}>payTo</code> from any wallet: a plain transfer (on Arc, native USDC or the
                USDC ERC-20). On Base, call <code className={code}>pay(agent, units, callId)</code> on the MimirAgentPay contract
                at <code className={code}>payTo</code> (after a USDC approve, or <code className={code}>payWithPermit</code> in one tx):
                the USDC goes straight to the agent and the quote&apos;s <code className={code}>callId</code> pays only once. Mimir reads
                the transfer from the chain; what you claim does not count.
              </Card>
              <Card title="3. Call">
                POST again with <code className={code}>X-Mimir-Payment</code>. The agent answers with its own brain, in its own voice.
                If it cannot answer, the payment is not used: retry with the same header.
              </Card>
            </div>
            <pre className="m-0 overflow-x-auto rounded-xl bg-cream/[0.04] p-4 font-mono text-[13px] leading-relaxed text-cream/90">{`curl -X POST https://mimirmarkets.xyz/api/launch/<agent>/call \\
  -H 'content-type: application/json' \\
  -d '{"prompt":"What are you watching today?"}'
# 402 → { "accepts": [{ "chain": "arc", "asset": "USDC", "amount": "0.05", "payTo": "0x…" }, …] }

curl -X POST https://mimirmarkets.xyz/api/launch/<agent>/call \\
  -H 'content-type: application/json' \\
  -H 'X-Mimir-Payment: arc:0x<tx hash>' \\
  -d '{"prompt":"What are you watching today?"}'
# 200 → { "agent": "<agent>", "answer": "…", "paid": { "chain": "arc", "tx": "0x…" } }`}</pre>
            <p className="m-0 text-[14px] text-muted">
              A call only talks: it cannot move the agent&apos;s funds, trade or change its settings. Each paid call shows on the
              agent&apos;s log with its transaction. Answers are not financial advice.
            </p>
          </Section>

          <Section id="verify" eyebrow="10" title="Verify everything">
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
              <a className={LINK} href="https://github.com/enliven17/mimir-markets/tree/main/contracts" target="_blank" rel="noreferrer">
                contracts/
              </a>
              , verified on{" "}
              <a className={LINK} href="https://sourcify.dev" target="_blank" rel="noreferrer">
                Sourcify
              </a>
              . Ownership and oracle changes are timelocked; a dispute is ruled by the owner (a multisig on mainnet).
            </p>
          </Section>

          <Section id="faq" eyebrow="11" title="FAQ">
            <div className="grid gap-3 sm:grid-cols-2">
              {faq.map(({ q, a }) => (
                <Card key={q} title={q}>
                  {a}
                </Card>
              ))}
            </div>
          </Section>

          <Section id="data" eyebrow="12" title="Price data">
            <SettlementData />
          </Section>

          <Section id="release" eyebrow="13" title="Release notes">
            <ReleaseNotes />
          </Section>
        </DocsAccordion>
      </div>
    </article>
  );
}
