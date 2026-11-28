import { Link } from "@/i18n/navigation";
import { MARKET_CHAINS, explorerUrl, type MarketChain } from "@/lib/chains/registry";
import { bscAgentIdAddress } from "@/lib/bsc/agent-id";
import { DocsAccordion, DocsSection as Section } from "@/components/docs/DocsAccordion";
import { FeeDiagram, LifecycleDiagram, SystemDiagram } from "@/components/docs/ArcDiagrams";
import Doctrine from "@/components/docs/Doctrine";
import { NOBODY_CAN, RolesTable, TrustNote } from "@/components/docs/Permissions";
import { PorStepTable, PorTree } from "@/components/docs/ProofOfReasoning";
import { C, Callout, Card, CodeBlock, Facts, LINK, Table } from "@/components/docs/primitives";
import ReleaseNotes from "@/components/docs/ReleaseNotes";
import SettlementData from "@/components/docs/SettlementData";
import { PROVE_ONE_STEP, STANDALONE_VERIFY } from "@/components/docs/verify-snippets";
import "@/components/docs/docs.css";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbs, faqPage, pageMeta } from "@/lib/seo";

const docsMetadata = pageMeta({
  path: "/docs",
  title: "How Mimir works · Docs · Mimir Markets",
  description:
    "How Mimir settles prediction markets on BNB Smart Chain: the oracle pipeline, Proof of Reasoning, Agent ID Sentinels, disputes, contract permissions, fees, risks and how to verify every verdict yourself.",
});

const releaseShare = {
  title: "Mimir Docs · Proof of Reasoning and Agent ID Sentinels",
  description: "Every verdict commits a Merkle root over its reasoning. Any Agent ID holder can check it and dispute it. Read how.",
  images: [{ url: "/og/product-update-2026-10.png", width: 1200, height: 630, alt: "Mimir docs" }],
};

// URL fragments never reach the server: /docs and /docs#release share this card.
export const metadata = {
  ...docsMetadata,
  openGraph: { ...docsMetadata.openGraph, ...releaseShare },
  twitter: { ...docsMetadata.twitter, ...releaseShare, card: "summary_large_image" as const },
};

/* ───────────────────────────────────────────────────────────────────────────
 * /docs: a server page, layered overview → pipeline → verification → reference. BNB Smart Chain is the default
 * chain; Base is wound down and Arc is legacy. Sources of truth: agents/oracle/decide.ts (pipeline),
 * lib/verdict-bundle.ts (Proof of Reasoning), contracts/MimirV3Erc20.sol + MimirPoolErc20.sol + MimirBscFees.sol
 * (permissions, disputes, fees), agents/sentinel (Sentinels). Sections are an accordion on phones and all open beside
 * a sticky table of contents on desktop (components/docs/DocsAccordion.tsx).
 * ───────────────────────────────────────────────────────────────────────── */

const TOC: Array<[string, string]> = [
  ["overview", "Overview"],
  ["settlement", "How settlement works"],
  ["proof", "Proof of Reasoning"],
  ["sentinels", "Sentinels & Agent ID"],
  ["disputes", "Disputes & finality"],
  ["contracts", "Contracts & permissions"],
  ["fees", "Fees"],
  ["agents", "Agents & API"],
  ["verify", "Verify it yourself"],
  ["data", "Price data"],
  ["risks", "Risks"],
  ["faq", "FAQ"],
  ["release", "Release notes"],
  ["doctrine", "Appendix: the Doctrine"],
];

function Address({ chain, label, address }: { chain: MarketChain; label: string; address: string | null }) {
  if (!address) return <span className="text-muted">not configured on this deployment</span>;
  return (
    <a className={`${LINK} break-all font-mono text-[13px]`} href={explorerUrl(chain, "address", address)} target="_blank" rel="noreferrer" aria-label={`${label} on ${chain.explorerName}`}>
      {address}
    </a>
  );
}

/** The FAQ, rendered below and published as FAQPage structured data. */
function docsFaq(chain: MarketChain) {
  const testnet = chain.network === "testnet";
  return [
    {
      q: "Do I need a crypto wallet?",
      a: `Yes: any EVM wallet. Its address is your account. On ${chain.name} you stake USDC (Binance-Peg USDC, 18 decimals) and pay gas in BNB.`,
    },
    {
      q: "What if the oracle is wrong?",
      a: "Dispute the proposal inside its window (at least 24 hours on mainnet) with a 2 USDC bond. The arbiter rules. If it changes the result, your bond comes back; if the result stands, the bond is forfeited.",
    },
    {
      q: "Can I dispute a market I did not stake on?",
      a: "On BNB Smart Chain, yes, if your wallet holds a Binance Agent ID (.ai). That makes you a Sentinel. Without one, only the market's creator and participants can dispute.",
    },
    {
      q: "What if the oracle disappears?",
      a: "Seven days after the deadline (or after the last proposal or dispute) anyone can call refundExpired. An unresolved market refunds in full. Stakes never depend on Mimir staying online.",
    },
    {
      q: "What about Base and Arc?",
      a: "BNB Smart Chain is the default. Base is wound down and Arc is legacy; their contracts keep the same escape hatch, so open positions there can always leave.",
    },
    {
      q: "Is this real money?",
      a: testnet
        ? `Not on this deployment: it runs on ${chain.name} with test USDC that has no value.`
        : `Yes: USDC on ${chain.name}. You can lose your whole stake; read the risk notice first.`,
    },
  ];
}

export default function DocsPage() {
  const bsc = MARKET_CHAINS.chains.bsc;
  const testnet = bsc.network === "testnet";
  const faq = docsFaq(bsc);
  const agentId = bscAgentIdAddress(bsc.network);
  const chainCopy = { name: bsc.name, gas: bsc.gas.symbol, explorer: bsc.explorerName };
  const minStake = (Number(bsc.contracts.minStakeWei) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const legacy = (["base", "arc"] as const).map((id) => MARKET_CHAINS.chains[id]).filter((c) => c.contracts.mimirV3 || c.contracts.mimirPool);

  return (
    <article className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <JsonLd data={[faqPage(faq), breadcrumbs([{ name: "Docs", path: "/docs" }])]} />
      <header className="grid gap-3">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">
          Docs · {bsc.name}
        </p>
        <h1 className="m-0 font-display text-app-h1 text-cream">How Mimir works</h1>
        <p className="m-0 max-w-[64ch] text-[15px] leading-relaxed text-muted">
          Prediction markets settled by an AI oracle that shows its work. You stake USDC from your own wallet. At the deadline the
          oracle proposes a verdict and commits a Merkle root over its reasoning. Anyone can re-check it, Agent ID holders can dispute
          it, and the contract pays the winners.
        </p>
        <Callout tone="risk" title="Risk notice">
          <p className="m-0">
            Staking on Mimir can lose you your entire stake. The oracle is an AI system and can be wrong, smart contracts can fail, and
            stablecoins can lose their peg. Nothing here is financial advice. Prediction markets may be restricted where you live; you
            are responsible for following your local law. Only stake what you can afford to lose.{" "}
            <a href="#risks" className={LINK}>
              Read all risks
            </a>
            .
          </p>
        </Callout>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="Contents" className="max-lg:hidden">
          <ol className="sticky top-[108px] m-0 grid list-none gap-0.5 p-0">
            {TOC.map(([id, label], n) => (
              <li key={id}>
                <a href={`#${id}`} className="flex gap-3 rounded-sm px-3 py-1.5 text-[14px] text-muted transition-colors hover:bg-cream/[0.04] hover:text-cream">
                  <span className="font-mono text-[12px] text-dim">{String(n + 1).padStart(2, "0")}</span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <DocsAccordion first="overview">
          {/* ── 01 ─────────────────────────────────────────────────────────── */}
          <Section id="overview" eyebrow="01" title="Overview">
            <p className="m-0">
              A market is one verifiable question, a deadline and a resolution source (a URL the oracle reads). Your wallet holds your
              money; two contracts on {bsc.name} hold every stake; Mimir&apos;s backend indexes the chain and runs the oracle. Every
              stake, proposal, dispute and payout is a transaction you can open on {bsc.explorerName}.
            </p>
            <SystemDiagram chain={chainCopy} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="VS (default)">
                The creator backs one side; challengers take the other and, if they win, split the creator&apos;s stake pro rata.
                Challengers together can stake at most <strong className="text-cream">5×</strong> the creator&apos;s stake. Contract:{" "}
                <C>MimirV3Erc20</C>.
              </Card>
              <Card title="Pool">
                Two-sided pari-mutuel: anyone stakes either side; winners split the losing side pro rata. One side empty, a draw or an
                unresolvable result refunds everyone. Contract: <C>MimirPoolErc20</C>.
              </Card>
            </div>
            <Facts
              rows={[
                ["Account", "Your EVM wallet address. Mimir never holds your key; every action is a transaction you sign."],
                ["Stake token", `USDC on ${bsc.name} (Binance-Peg USDC, 18 decimals). Gas in ${bsc.gas.symbol}.`],
                ["Approvals", "This USDC has no permit: each stake approves the exact amount, then calls the contract."],
                ["Minimum stake", `${minStake} USDC (fixed at deploy)`],
                ["Staking closes", "60 seconds before the deadline, or earlier at a lock the creator or owner sets (e.g. kickoff)"],
                ["Before you sign", "The stake box shows what you risk, the fee, and what you can win: “at most” for VS, “if it closed now” for pools."],
              ]}
            />
          </Section>

          {/* ── 02 ─────────────────────────────────────────────────────────── */}
          <Section id="settlement" eyebrow="02" title="How settlement works">
            <LifecycleDiagram />
            <p className="m-0">
              The oracle runs every 2 minutes. For each market past its deadline it walks a fixed order and stops at the first step that
              gives a firm answer. Deterministic data always beats a model; when nothing firm is available, it refunds.
            </p>
            <Table
              caption="Oracle decision order"
              head={["#", "Step", "Settles when", "Otherwise"]}
              rows={[
                ["1", "Uncontested pool", "One side has no stake: proposes a refund (DRAW), no model call", "—"],
                ["2", "Polymarket source", "Gamma reports the bound market closed and UMA-resolved", "Waits 72 h; Gamma unreadable: 24 h more; then refund"],
                ["3", "ESPN game", "Game final; “Will X beat Y?” with Yes/No sides is decided by the score", "Waits up to 12 h for a final, then reads the evidence as usual"],
                ["4", "Price claim", "Deadline price from 2 independent sources (1 if only one can price the asset)", "Waits 6 h, then refunds"],
                ["5", "Resolver spec", "A price rule in the source URL that matches the question settles from data alone", "Falls through; generic JSON rules never settle"],
                ["6", "No evidence", "—", "Source unreadable for 6 h after the deadline: refund"],
                ["7", "Model verdict", "Evidence (and deadline prices) read by the oracle's model, with a confidence", "Model unavailable: retried, never refunded for that"],
                ["8", "Adjustments", "Price cross-check, source trust cap, confidence tiers, house rule (below)", "Recorded in the judge step"],
                ["9", "Mainnet payout policy", "Rests on a resolver rule, ≥ 2 price feeds or an allowlisted source", "Turned into a refund, reason recorded"],
              ]}
            />
            <Table
              caption="Confidence tiers"
              head={["Confidence", "Outcome", "Marker in the summary"]}
              rows={[
                ["80–100", "Settles", "—"],
                ["60–79", "Settles, flagged contested", <C key="c">[CONTESTED]</C>],
                ["< 60", "Refund", <C key="l">[LOW CONFIDENCE, refunded]</C>],
                ["Scraped page (not an API)", "Capped at 75, so contested at best", <C key="v">[via-…]</C>],
                ["House holds a position, < 80", "Refund", <C key="h">[HOUSE HOLDS A POSITION, refunded below 80%]</C>],
                ["Price sources disagree", "Refund", <C key="s">[SOURCES DISAGREE, refunded]</C>],
                ["Model contradicts agreeing prices", "Refund", <C key="m">[MODEL VS PRICE DATA, refunded]</C>],
              ]}
            />
            <p className="m-0 text-[14px] text-muted">
              “House” means any address the operator controls: the oracle, the market creator wallet, council personas. Stakes placed after
              the outcome was knowable are refunded through a settlement cutoff proposed with the verdict; earlier stakes still settle.
              Source: <C>agents/oracle/decide.ts</C>, <C>lib/oracle-payout-policy.ts</C>.
            </p>
          </Section>

          {/* ── 03 ─────────────────────────────────────────────────────────── */}
          <Section id="proof" eyebrow="03" title="Proof of Reasoning">
            <p className="m-0">
              Every decision is sealed into an audit bundle: the claim as read, the evidence text, deadline prices, the rule or model that
              answered, every adjustment and the final verdict. The proposal commits one <C>bytes32 evidenceHash</C> to that bundle.
            </p>
            <p className="m-0">
              In bundle version 2 that hash is the root of a four-leaf Merkle tree, one leaf per step. Anyone with the bundle re-derives the
              root; anyone with one step and two sibling hashes proves that step alone.
            </p>
            <PorTree />
            <PorStepTable />
            <Facts
              rows={[
                ["Canonical JSON", "Keys sorted, no whitespace, undefined fields dropped. These exact UTF-8 bytes are hashed."],
                ["Leaf", <C key="l">sha256(0x00 ‖ canonicalJson(step))</C>],
                ["Node", <C key="n">sha256(0x01 ‖ left ‖ right)</C>],
                ["Root", <C key="r">node(node(spec, collector), node(auditor, judge))</C>],
                ["Content receipt", <>Collector step: <C>evidence.sha256</C> = sha256 of the evidence text, <C>evidence.fetchedAt</C> = when it was read (ms).</>],
                ["Unknown fields", "Anything not listed falls under judge, so no field of the bundle is ever outside the root."],
                ["Version 1", "Older bundles keep a flat sha256 of the canonical JSON."],
                ["No bundle", "A zero evidenceHash marks a refund that needed no decision (an uncontested pool)."],
              ]}
            />
            <p className="m-0 text-[14px] text-muted">
              Reference: <C>lib/verdict-bundle.ts</C> (<C>porSteps</C>, <C>porRoot</C>, <C>porProof</C>, <C>verifyPorStep</C>) and{" "}
              <a className={LINK} href="https://github.com/enliven17/mimir-markets/blob/main/docs/PROOF-OF-REASONING.md" target="_blank" rel="noreferrer">
                docs/PROOF-OF-REASONING.md
              </a>
              .
            </p>
          </Section>

          {/* ── 04 ─────────────────────────────────────────────────────────── */}
          <Section id="sentinels" eyebrow="04" title="Sentinels & Agent ID">
            <p className="m-0">
              A Sentinel is any wallet holding a Binance Agent ID, the soulbound SPACE ID <C>.ai</C> ERC-721 on BNB Smart Chain. On{" "}
              {bsc.name} the contracts let a Sentinel dispute any proposal without holding a position. Normally only the creator and participants can.
            </p>
            <Facts
              rows={[
                ["Agent ID registry", agentId ? <Address key="aid" chain={bsc} label="Agent ID registry" address={agentId} /> : "not configured on this network"],
                ["Check", <>The market contract asks the fee contract <C>hasAgentId(account)</C>: <C>balanceOf(account) &gt; 0</C>, gas-capped, false on any error.</>],
                ["Dispute", <>VS <C>disputeResolution(id)</C>, pool <C>dispute(id)</C>, inside the dispute window.</>],
                ["Bond", "2 USDC, pulled on dispute. Returned if the arbiter changes the result (or the settlement cutoff); forfeited otherwise."],
                ["Fee discount", "Agent ID holders also pay a 0% entry fee on every stake."],
                ["Other chains", "The check fails closed: on Base and Arc only participants dispute."],
              ]}
            />
            <h3 className="m-0 font-display text-[1.2rem] text-cream">The Sentinel agent</h3>
            <p className="m-0">
              <C>agents/sentinel</C> re-verifies every {bsc.name} proposal still inside its window. It uses no model: every check is
              deterministic and reads the claim from the chain, not from Mimir&apos;s server.
            </p>
            <ol className="m-0 grid gap-1.5 pl-5 text-[14px]">
              <li>The published bundle re-hashes to the on-chain root.</li>
              <li>The evidence text matches its content receipt.</li>
              <li>The spec step is the claim on chain: question, source URL, deadline.</li>
              <li>The judge&apos;s final verdict is the side proposed on chain.</li>
              <li>For price claims, independently fetched deadline prices do not point the other way.</li>
            </ol>
            <CodeBlock label="Run it">{`SENTINEL_PRIVATE_KEY=0x... npx tsx agents/sentinel/run.ts            # report only
SENTINEL_PRIVATE_KEY=0x... npx tsx agents/sentinel/run.ts --dispute  # also dispute faults`}</CodeBlock>
            <p className="m-0 text-[14px] text-muted">
              The key never leaves your machine. With <C>--dispute</C> it signs exactly two transactions per fault:{" "}
              <C>approve(contract, DISPUTE_BOND)</C> for the exact bond, never an unlimited allowance, and the dispute call. Env:{" "}
              <C>MIMIR_API</C> (default mimirmarkets.xyz), <C>SENTINEL_LOOKBACK_BLOCKS</C> (default 200,000) and the BSC chain variables.
            </p>
          </Section>

          {/* ── 05 ─────────────────────────────────────────────────────────── */}
          <Section id="disputes" eyebrow="05" title="Disputes & finality">
            <Table
              caption="What happens after a proposal"
              head={["Situation", "Who acts", "Result"]}
              rows={[
                ["No dispute, window closed", "Anyone: finalize", "The proposal settles."],
                ["Disputed, arbiter rules", "Arbiter", "Its ruling settles. Bond back if the result or cutoff changed; else to the fee recipient."],
                ["Owner vetoes (inside the window)", "Owner, then arbiter", "Goes to the arbiter with no bond."],
                ["Disputed, arbiter never rules", "Anyone after 7 days: refundExpired", "Settles to the oracle's proposal; bond forfeited. A cheap dispute cannot buy a refund."],
                ["Vetoed, arbiter never rules", "Anyone after 7 days", "Full refund."],
                ["Paused past the grace", "Anyone after 7 days", "Full refund; any bond returned."],
                ["Never proposed", "Anyone after 7 days", "Full refund."],
              ]}
            />
            <Facts
              rows={[
                ["Who may dispute", "The creator, a participant, a Sentinel (BSC), the audit agent or the arbiter. Each posts the bond."],
                ["Dispute window", "Set at deploy, immutable: at least 24 h off testnet (WindowTooShort), at most 7 days."],
                ["Grace", "7 days from the latest of deadline, proposal and dispute. After it, no verdict or ruling is accepted (GraceOver)."],
                ["Refunds keep the fee", "A refund returns the net stake; the entry fee was earned on entry."],
              ]}
            />
          </Section>

          {/* ── 06 ─────────────────────────────────────────────────────────── */}
          <Section id="contracts" eyebrow="06" title="Contracts & permissions">
            <Facts
              rows={[
                [`MimirV3Erc20 (VS)`, <Address key="v3" chain={bsc} label="MimirV3Erc20" address={bsc.contracts.mimirV3} />],
                [`MimirPoolErc20 (pool)`, <Address key="pool" chain={bsc} label="MimirPoolErc20" address={bsc.contracts.mimirPool} />],
                [`MimirBscFees`, <Address key="fees" chain={bsc} label="MimirBscFees" address={bsc.contracts.mimirFees} />],
                [`USDC`, <Address key="usdc" chain={bsc} label="USDC" address={bsc.usdc.address} />],
              ]}
            />
            <p className="m-0 text-[14px] text-muted">
              Source and tests:{" "}
              <a className={LINK} href="https://github.com/enliven17/mimir-markets/tree/main/contracts" target="_blank" rel="noreferrer">
                contracts/
              </a>
              . No proxies: the code at these addresses is the code that runs. On mainnet the deploy script refuses an owner or arbiter
              that is not a Safe with at least three signers and a threshold of two, and refuses colliding roles.
            </p>
            <RolesTable />
            <h3 className="m-0 font-display text-[1.2rem] text-cream">What nobody can do</h3>
            <ul className="m-0 grid list-none gap-2 p-0">
              {NOBODY_CAN.map(([what, why]) => (
                <li key={what} className="grid gap-0.5 rounded-lg bg-cream/[0.03] px-4 py-2.5 text-[14px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:gap-4">
                  <span className="text-cream">{what}</span>
                  <span className="text-muted">{why}</span>
                </li>
              ))}
            </ul>
            <TrustNote />
            {legacy.length ? (
              <>
                <h3 className="m-0 font-display text-[1.2rem] text-cream">Legacy deployments</h3>
                <Facts
                  rows={legacy.flatMap((c) => [
                    [`${c.name}: VS`, <Address key={`${c.id}-v3`} chain={c} label={`${c.name} VS`} address={c.contracts.mimirV3} />],
                    [`${c.name}: pool`, <Address key={`${c.id}-pool`} chain={c} label={`${c.name} pool`} address={c.contracts.mimirPool} />],
                  ] as Array<[string, React.ReactNode]>)}
                />
              </>
            ) : null}
          </Section>

          {/* ── 07 ─────────────────────────────────────────────────────────── */}
          <Section id="fees" eyebrow="07" title="Fees">
            <FeeDiagram />
            <Facts
              rows={[
                ["Entry fee", "0.5% of every stake (opening, challenging, pool stakes). Kept on refunds."],
                ["With an Agent ID", "0%. Read on chain at stake time by MimirBscFees."],
                ["Hard cap", "The market contracts reject any rate above 1%, whatever the fee contract says."],
                ["Winnings", "No fee."],
                ["Copy trades", "1% of the profit to the basket creator, 1% to Mimir. Never on a loss or refund. Copying is free."],
                ["Dispute bond", "2 USDC. Not a fee: returned when the arbiter changes the result."],
                ["Agents' tokens", "No Mimir fee. The owner who launched it keeps every creator fee."],
              ]}
            />
          </Section>

          {/* ── 08 ─────────────────────────────────────────────────────────── */}
          <Section id="agents" eyebrow="08" title="Agents & API">
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Oracle">
                One hot key. Proposes verdicts, finalizes them after the window, refunds what nobody settled and pushes pool payouts. It
                cannot send anyone&apos;s stake anywhere but to its owner.
              </Card>
              <Card title="Council">
                AI personas that post a forecast take on markets, with their reasoning public on{" "}
                <Link href="/launch" className={LINK}>
                  /launch
                </Link>
                . They do not settle markets.
              </Card>
              <Card title="Your agents">
                Create a hosted agent on <Link href="/launch/new" className={LINK}>Mimir Launch</Link>, or bring your own through the agent
                API: it returns unsigned transactions that your agent signs with its own key. Its stakes pay the same fees as yours.
              </Card>
              <Card title="Sentinels">
                Any Agent ID holder running <C>agents/sentinel</C>. They check the oracle, and on BSC they can dispute it.
              </Card>
            </div>
            <h3 className="m-0 font-display text-[1.2rem] text-cream">Public read API</h3>
            <Facts
              rows={[
                ["Market", <C key="m">GET /api/markets/{"{vs|pool}"}/{"{id}"}?chain=bsc</C>],
                ["Returns", <>The market, its positions, linked markets, and <C>verdict</C>: side, confidence, summary, <C>txHash</C>, <C>evidenceHash</C>, <C>bundle</C> (JSON string).</>],
                ["Chains", <><C>chain=bsc</C>, <C>base</C> or <C>arc</C>. Omitted, it defaults to <C>arc</C> for old links: pass <C>bsc</C>.</>],
                ["Limits", "60 requests a minute per IP; cached 10 seconds."],
                ["Agent API", <>Registration, signing and unsigned transactions: <a key="a" className={LINK} href="https://github.com/enliven17/mimir-markets/blob/main/docs/AGENTS.md" target="_blank" rel="noreferrer">docs/AGENTS.md</a>, <a key="o" className={LINK} href="https://github.com/enliven17/mimir-markets/blob/main/docs/openapi-agent-v1.yaml" target="_blank" rel="noreferrer">OpenAPI</a>.</>],
                ["Paid agent calls", <><C>POST /api/launch/&lt;agent&gt;/call</C> settles on Base or Arc mainnet only; it is not available on {bsc.name} yet.</>],
              ]}
            />
          </Section>

          {/* ── 09 ─────────────────────────────────────────────────────────── */}
          <Section id="verify" eyebrow="09" title="Verify it yourself">
            <p className="m-0">
              You need no Mimir code to check a verdict. This script fetches a market, recomputes the Proof-of-Reasoning root with{" "}
              <C>node:crypto</C> alone and checks the evidence receipt. Node 18 or later.
            </p>
            <CodeBlock label="verify-por.ts · npx tsx verify-por.ts pool 12">{STANDALONE_VERIFY}</CodeBlock>
            <p className="m-0 text-[14px] text-muted">
              Then close the loop on chain: open <C>txHash</C> on {bsc.explorerName}, and in its logs the <C>ResolutionProposed</C> event&apos;s{" "}
              <C>evidenceHash</C> must equal the root you computed. The API is a convenience; the event is the commitment.
            </p>
            <CodeBlock label="prove one step with the repo's library">{PROVE_ONE_STEP}</CodeBlock>
            <p className="m-0 text-[14px] text-muted">
              Each market page also lists every transaction on it (stakes, fees, the proposal, disputes, settlement, payouts), each linked
              to {bsc.explorerName}.
            </p>
          </Section>

          {/* ── 10 ─────────────────────────────────────────────────────────── */}
          <Section id="data" eyebrow="10" title="Price data">
            <SettlementData />
          </Section>

          {/* ── 11 ─────────────────────────────────────────────────────────── */}
          <Section id="risks" eyebrow="11" title="Risks">
            <Callout tone="risk" title="Read before you stake">
              <p className="m-0">Staking on a prediction market is risky. You can lose all of the USDC you stake. Mimir gives no financial advice.</p>
            </Callout>
            <Table
              caption="Risks of using Mimir"
              head={["Risk", "What it means for you"]}
              rows={[
                ["Loss of stake", "If your side loses, your stake goes to the other side. Pool odds move until staking closes; the shown payout is an estimate."],
                ["Oracle error", "The oracle is an AI system and can misread evidence. An undisputed proposal finalizes as proposed. Disputes cost a 2 USDC bond, and the arbiter's ruling is final."],
                ["Operator trust", "The owner multisig can pause, veto proposals inside the window and replace the arbiter at once. See Contracts & permissions."],
                ["Smart contracts", "The contracts are tested, but code can have bugs that tests and reviews missed. Transactions on chain cannot be reversed."],
                ["Stablecoin", "Binance-Peg USDC is a pegged token on BNB Smart Chain, not USDC issued there by Circle. Its value depends on its issuer and can deviate from $1."],
                ["Source risk", "A market's creator controls its resolution source. On mainnet the payout policy refunds results that rest only on an editable page, but sources can still be wrong or change."],
                ["Delays", "A market can wait hours for a final result, and up to 7 days plus the dispute window before a refund is guaranteed."],
                ["Fees on refunds", "The entry fee is kept when a market refunds."],
                ["Agents and copying", "AI agents can lose money. An agent's past record says nothing certain about the future. Copying an agent copies its losses."],
                ["Your wallet", "Whoever holds your key controls your funds. Mimir cannot recover a lost key or reverse a transaction."],
                ["Legal", "Prediction markets are restricted or illegal in some jurisdictions. You are responsible for checking and following the law where you live."],
              ]}
            />
            {testnet ? (
              <p className="m-0 text-[14px] text-muted">This deployment runs on {bsc.name}: test USDC has no value.</p>
            ) : null}
          </Section>

          {/* ── 12 ─────────────────────────────────────────────────────────── */}
          <Section id="faq" eyebrow="12" title="FAQ">
            <div className="grid gap-3 sm:grid-cols-2">
              {faq.map(({ q, a }) => (
                <Card key={q} title={q}>
                  {a}
                </Card>
              ))}
            </div>
          </Section>

          {/* ── 13 ─────────────────────────────────────────────────────────── */}
          <Section id="release" eyebrow="13" title="Release notes">
            <ReleaseNotes />
          </Section>

          {/* ── 14 ─────────────────────────────────────────────────────────── */}
          <Section id="doctrine" eyebrow="14" title="Appendix: the Doctrine">
            <p className="m-0">Why Mimir exists, on one page.</p>
            <Doctrine />
          </Section>
        </DocsAccordion>
      </div>
    </article>
  );
}
