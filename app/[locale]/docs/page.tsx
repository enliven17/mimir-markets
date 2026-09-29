"use client";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";

/* ───────────────────────────────────────────────────────────────────────────
 * Mimir docs — 100% Solana.
 *
 * Inline SVG diagrams drawn with the blueprint tokens (CSS variables, so they
 * follow the light/dark toggle) and sharp corners. Each is responsive via
 * `viewBox`. No EVM / Arc / Circle-CCTP content anywhere.
 * ───────────────────────────────────────────────────────────────────────── */

const C = {
  bg: "rgb(var(--pv-bg))",
  surface: "rgb(var(--pv-surface))",
  surf2: "rgb(var(--pv-surface2))",
  border: "rgb(var(--pv-border) / 0.35)",
  text: "rgb(var(--pv-text))",
  muted: "rgb(var(--pv-muted))",
  accent: "rgb(var(--pv-accent))",
};

/* ── 1. Architecture diagram ─────────────────────────────────────────────── */
function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 900 380" className="h-auto w-full" role="img" aria-label="Mimir architecture diagram">
      <defs>
        <marker id="arrow-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill={C.accent} />
        </marker>
      </defs>

      {/* Users */}
      <g>
        <rect x="20" y="160" width="130" height="64" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="85" y="188" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>Users</text>
        <text x="85" y="206" textAnchor="middle" fontSize="10" fill={C.muted}>Phantom / Solflare</text>
      </g>

      {/* Frontend (Web tier) */}
      <g>
        <rect x="200" y="40" width="230" height="120" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="315" y="68" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">WEB TIER · NEXT.JS 16</text>
        <text x="315" y="96" textAnchor="middle" fontSize="14" fontWeight="700" fill={C.text}>/arena · /arena/[id]</text>
        <text x="315" y="118" textAnchor="middle" fontSize="11" fill={C.muted}>wallet-adapter signing</text>
        <text x="315" y="138" textAnchor="middle" fontSize="11" fill={C.muted}>/api/arena/claims feed</text>
      </g>

      {/* Workers */}
      <g>
        <rect x="200" y="210" width="230" height="130" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="315" y="238" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">WORKER TIER · NODE</text>
        <text x="315" y="262" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>oracle · creator · council</text>
        <text x="315" y="282" textAnchor="middle" fontSize="11" fill={C.muted}>11 agents, Solana keypairs</text>
        <text x="315" y="300" textAnchor="middle" fontSize="11" fill={C.muted}>poll, challenge, settle, hedge</text>
        <text x="315" y="320" textAnchor="middle" fontSize="11" fill={C.muted}>long-lived on Railway</text>
      </g>

      {/* Solana base layer */}
      <g>
        <rect x="490" y="40" width="220" height="130" fill={C.surf2} stroke={C.accent} strokeWidth="1.8" />
        <text x="600" y="68" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">SOLANA DEVNET</text>
        <text x="600" y="94" textAnchor="middle" fontSize="14" fontWeight="700" fill={C.text}>Mimir Anchor program</text>
        <text x="600" y="116" textAnchor="middle" fontSize="11" fill={C.muted}>USDC vault PDA</text>
        <text x="600" y="134" textAnchor="middle" fontSize="11" fill={C.muted}>claim + balance PDAs</text>
        <text x="600" y="152" textAnchor="middle" fontSize="11" fill={C.muted}>resolve + payout cranks</text>
      </g>

      {/* Ephemeral Rollup */}
      <g>
        <rect x="490" y="210" width="220" height="130" fill={C.surface} stroke={C.accent} strokeWidth="1.8" strokeDasharray="5 3" />
        <text x="600" y="238" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">MAGICBLOCK ER</text>
        <text x="600" y="264" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>delegated PDAs</text>
        <text x="600" y="284" textAnchor="middle" fontSize="11" fill={C.muted}>zero-fee challenges</text>
        <text x="600" y="302" textAnchor="middle" fontSize="11" fill={C.muted}>~30ms execution</text>
        <text x="600" y="320" textAnchor="middle" fontSize="11" fill={C.muted}>commit / undelegate</text>
      </g>

      {/* Flash Trade + LLM */}
      <g>
        <rect x="760" y="120" width="120" height="60" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="820" y="144" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.muted} letterSpacing="1.5">FLASH TRADE</text>
        <text x="820" y="162" textAnchor="middle" fontSize="10" fill={C.text}>prices · perps</text>
        <rect x="760" y="200" width="120" height="60" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="820" y="224" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.muted} letterSpacing="1.5">LLM PROVIDER</text>
        <text x="820" y="242" textAnchor="middle" fontSize="10" fill={C.text}>Gemini · Claude</text>
      </g>

      {/* Arrows */}
      <line x1="150" y1="192" x2="198" y2="100" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      <line x1="150" y1="192" x2="198" y2="275" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      <line x1="430" y1="100" x2="488" y2="100" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      <line x1="430" y1="275" x2="488" y2="275" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      {/* base <-> ER delegation */}
      <line x1="600" y1="170" x2="600" y2="208" stroke={C.accent} strokeWidth="1.6" strokeDasharray="3 3" markerEnd="url(#arrow-a)" markerStart="url(#arrow-a)" />
      {/* workers reach flash + llm */}
      <line x1="430" y1="250" x2="758" y2="150" stroke={C.accent} strokeWidth="1.2" strokeDasharray="2 3" markerEnd="url(#arrow-a)" />
      <line x1="430" y1="270" x2="758" y2="230" stroke={C.accent} strokeWidth="1.2" strokeDasharray="2 3" markerEnd="url(#arrow-a)" />
    </svg>
  );
}

/* ── 2. Two-layer state model ────────────────────────────────────────────── */
function TwoLayerDiagram() {
  return (
    <svg viewBox="0 0 900 320" className="h-auto w-full" role="img" aria-label="Two-layer state model">
      <defs>
        <marker id="arrow-tl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill={C.accent} />
        </marker>
      </defs>

      {/* Base layer */}
      <g>
        <rect x="30" y="30" width="380" height="260" fill={C.bg} stroke={C.accent} strokeWidth="1.8" />
        <text x="220" y="58" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">BASE LAYER · SOLANA — OWNS ALL USDC</text>

        <rect x="60" y="80" width="320" height="56" fill={C.surf2} stroke={C.border} strokeWidth="1.4" />
        <text x="220" y="104" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>USDC Vault PDA</text>
        <text x="220" y="122" textAnchor="middle" fontSize="11" fill={C.muted}>all escrowed stakes, SPL token (6 decimals)</text>

        <rect x="60" y="150" width="150" height="50" fill={C.surface} stroke={C.border} strokeWidth="1.3" />
        <text x="135" y="170" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.text}>deposit / withdraw</text>
        <text x="135" y="188" textAnchor="middle" fontSize="10" fill={C.muted}>credits virtual balance</text>

        <rect x="230" y="150" width="150" height="50" fill={C.surface} stroke={C.border} strokeWidth="1.3" />
        <text x="305" y="170" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.text}>create_claim</text>
        <text x="305" y="188" textAnchor="middle" fontSize="10" fill={C.muted}>escrow + delegate</text>

        <rect x="60" y="214" width="150" height="50" fill={C.surface} stroke={C.border} strokeWidth="1.3" />
        <text x="135" y="234" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.text}>propose → finalize</text>
        <text x="135" y="252" textAnchor="middle" fontSize="10" fill={C.muted}>audit hash · 24h window</text>

        <rect x="230" y="214" width="150" height="50" fill={C.surface} stroke={C.border} strokeWidth="1.3" />
        <text x="305" y="234" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.text}>payout cranks</text>
        <text x="305" y="252" textAnchor="middle" fontSize="10" fill={C.muted}>pull USDC from vault</text>
      </g>

      {/* ER layer */}
      <g>
        <rect x="490" y="30" width="380" height="260" fill={C.bg} stroke={C.accent} strokeWidth="1.8" strokeDasharray="6 3" />
        <text x="680" y="58" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">EPHEMERAL ROLLUP — OWNS GAMEPLAY</text>

        <rect x="520" y="80" width="320" height="56" fill={C.surface} stroke={C.border} strokeWidth="1.4" />
        <text x="680" y="104" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>Delegated Claim PDAs</text>
        <text x="680" y="122" textAnchor="middle" fontSize="11" fill={C.muted}>question · stakes · challenger wall</text>

        <rect x="520" y="150" width="320" height="50" fill={C.surface} stroke={C.border} strokeWidth="1.3" />
        <text x="680" y="170" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>Delegated UserBalance PDAs</text>
        <text x="680" y="188" textAnchor="middle" fontSize="10" fill={C.muted}>virtual betting balance</text>

        <rect x="520" y="214" width="320" height="50" fill={C.surf2} stroke={C.border} strokeWidth="1.4" />
        <text x="680" y="234" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>challenge_claim ⚡</text>
        <text x="680" y="252" textAnchor="middle" fontSize="10" fill={C.muted}>debit balance, append challenger · zero fee</text>
      </g>

      {/* Cross-layer arrows */}
      <line x1="410" y1="175" x2="488" y2="175" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#arrow-tl)" />
      <text x="449" y="166" textAnchor="middle" fontSize="9" fontWeight="700" fill={C.muted}>delegate</text>
      <line x1="488" y1="240" x2="410" y2="240" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#arrow-tl)" />
      <text x="449" y="232" textAnchor="middle" fontSize="9" fontWeight="700" fill={C.muted}>commit</text>
    </svg>
  );
}

/* ── 3. Claim lifecycle (horizontal stepper) ─────────────────────────────── */
function LifecycleDiagram() {
  const steps = [
    { tag: "01", title: "Create", note: "Stake USDC → vault, delegate to ER" },
    { tag: "02", title: "Challenge", note: "Others bet in ER (zero fee)" },
    { tag: "03", title: "Wait", note: "Deadline passes" },
    { tag: "04", title: "Commit", note: "Oracle undelegates state" },
    { tag: "05", title: "Propose", note: "Resolver, prices or LLM" },
    { tag: "06", title: "Finalize", note: "Dispute window → payout" },
  ];
  const W = 1140;
  const H = 220;
  const padX = 60;
  const innerW = W - padX * 2;
  const stepW = innerW / steps.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Claim lifecycle">
      <line x1={padX} y1={H / 2} x2={W - padX} y2={H / 2} stroke={C.border} strokeWidth="2" />

      {steps.map((step, i) => {
        const cx = padX + stepW * i + stepW / 2;
        return (
          <g key={step.tag}>
            <circle cx={cx} cy={H / 2} r="14" fill={C.bg} stroke={C.accent} strokeWidth="2" />
            <text x={cx} y={H / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent}>{step.tag}</text>
            <text x={cx} y={H / 2 - 36} textAnchor="middle" fontSize="14" fontWeight="700" fill={C.text}>{step.title}</text>
            <text x={cx} y={H / 2 + 50} textAnchor="middle" fontSize="11" fill={C.muted}>{step.note}</text>
          </g>
        );
      })}

      <text x={padX} y={H / 2 - 60} fontSize="10" fontWeight="700" letterSpacing="2" fill={C.muted}>CREATOR</text>
      <text x={W - padX} y={H / 2 - 60} textAnchor="end" fontSize="10" fontWeight="700" letterSpacing="2" fill={C.muted}>ORACLE</text>
    </svg>
  );
}

/* ── 4. Oracle agent loop ────────────────────────────────────────────────── */
function AgentLoopDiagram() {
  return (
    <svg viewBox="0 0 900 380" className="h-auto w-full" role="img" aria-label="Oracle agent loop">
      <defs>
        <marker id="arrow-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill={C.accent} />
        </marker>
      </defs>

      {/* Poll loop center */}
      <g>
        <circle cx="200" cy="190" r="80" fill={C.surface} stroke={C.border} strokeWidth="1.8" />
        <text x="200" y="182" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>Poll loop</text>
        <text x="200" y="202" textAnchor="middle" fontSize="11" fill={C.muted}>every cycle</text>
      </g>

      {/* Settler branch */}
      <g>
        <rect x="380" y="50" width="290" height="120" fill={C.surf2} stroke={C.accent} strokeWidth="1.6" />
        <text x="525" y="76" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">ROLE A · SETTLER</text>
        <text x="525" y="100" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>ACTIVE claim · deadline passed</text>
        <text x="525" y="122" textAnchor="middle" fontSize="11" fill={C.muted}>undelegate → resolver / prices / evidence</text>
        <text x="525" y="142" textAnchor="middle" fontSize="11" fill={C.muted}>propose → finalize → crank payouts</text>
      </g>

      {/* Challenger branch */}
      <g>
        <rect x="380" y="200" width="290" height="140" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="525" y="226" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">ROLE B · CHALLENGER (opt-in)</text>
        <text x="525" y="250" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>OPEN / ACTIVE · AUTO_CHALLENGE=1</text>
        <text x="525" y="272" textAnchor="middle" fontSize="11" fill={C.muted}>early LLM read → confidence ≥ 80%</text>
        <text x="525" y="290" textAnchor="middle" fontSize="11" fill={C.muted}>Kelly-sized ER bet (≤ 25% bankroll)</text>
        <text x="525" y="308" textAnchor="middle" fontSize="11" fill={C.muted}>hedge with Flash Trade perp</text>
      </g>

      {/* Outcome */}
      <g>
        <rect x="710" y="120" width="170" height="140" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="795" y="146" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">ON-CHAIN</text>
        <text x="795" y="172" textAnchor="middle" fontSize="14" fontWeight="700" fill={C.text}>USDC payout</text>
        <text x="795" y="194" textAnchor="middle" fontSize="11" fill={C.muted}>sha256 evidence hash</text>
        <text x="795" y="212" textAnchor="middle" fontSize="11" fill={C.muted}>confidence tier stored</text>
        <text x="795" y="234" textAnchor="middle" fontSize="11" fill={C.muted}>vault cranks</text>
      </g>

      <line x1="280" y1="165" x2="378" y2="110" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-b)" />
      <line x1="280" y1="215" x2="378" y2="270" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-b)" />
      <line x1="670" y1="110" x2="708" y2="175" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-b)" />
      <line x1="670" y1="270" x2="708" y2="210" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-b)" />
    </svg>
  );
}

/* ── Section primitives ──────────────────────────────────────────────────── */
function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <BlueprintHeading eyebrow={eyebrow}>{title}</BlueprintHeading>
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-10 text-[15px] leading-relaxed text-pv-text/85 sm:px-6">
        {children}
      </div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-pv-border/25 bg-pv-surface p-5">
      <h3 className="mb-2 font-bold tracking-tight text-pv-text">{title}</h3>
      <div className="text-sm leading-relaxed text-pv-text/80">{children}</div>
    </div>
  );
}

function DiagramFrame({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <figure className="bp-paper my-4 border border-pv-border/25 bg-pv-bg p-5 sm:p-7">
      <div className="overflow-x-auto">{children}</div>
      <figcaption className="mt-3 text-center text-xs text-pv-muted">{caption}</figcaption>
    </figure>
  );
}

function TocLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="block border-l-2 border-pv-border/25 py-1 pl-3 text-sm text-pv-text/80 transition-colors hover:border-pv-emerald hover:text-pv-text"
    >
      {label}
    </a>
  );
}

const code = "bg-pv-surface2 px-1.5 py-0.5 text-xs";
const codeSm = "bg-pv-surface2 px-1 text-xs";

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function DocsPage() {
  return (
    <article>
      <BlueprintHeading
        as="h1"
        eyebrow="Mimir · documentation"
        subtitle="Mimir is an AI-settled prediction market on Solana. Two sides stake USDC on opposite answers to a verifiable question; the market lives inside a MagicBlock Ephemeral Rollup so every challenge is zero-fee and lands in ~30ms. When the deadline passes, the oracle settles it by rule where it can (a resolver spec, two independent price sources) and by an LLM on fetched evidence where it cannot, proposes the verdict on-chain, and anyone can dispute it with a bond for 24 hours before it finalizes."
      >
        How Mimir works
      </BlueprintHeading>

      {/* TOC */}
      <nav aria-label="Table of contents" className="border-b border-pv-border/25 px-4 py-6 sm:px-8">
        <p className="mx-auto mb-3 max-w-4xl text-[10px] font-bold uppercase tracking-[0.22em] text-pv-muted">Contents</p>
        <div className="mx-auto grid max-w-4xl gap-1 sm:grid-cols-3">
          <TocLink href="#what" label="1. What a claim is" />
          <TocLink href="#architecture" label="2. Architecture" />
          <TocLink href="#two-layer" label="3. The two-layer model" />
          <TocLink href="#lifecycle" label="4. The settlement lifecycle" />
          <TocLink href="#confidence" label="5. Confidence tiers" />
          <TocLink href="#agents" label="6. The AI agents" />
          <TocLink href="#terms" label="7. On-chain terms" />
          <TocLink href="#play" label="8. How to play" />
          <TocLink href="#faq" label="9. FAQ" />
        </div>
      </nav>

      <Section id="what" eyebrow="01" title="What a claim is">
        <p>
          A claim in Mimir is a single, verifiable question with a deadline and
          a designated resolution source — for example,{" "}
          <em>&ldquo;Will SOL trade above $67.46 at the deadline, per the Flash Trade oracle price?&rdquo;</em>
        </p>
        <p>
          Anyone creates a claim by staking USDC on one side. Anyone else —
          human or AI agent — challenges by staking the opposite side. Challenges
          happen inside the Ephemeral Rollup: instant, and free. At the deadline
          the oracle commits the rollup state back to Solana, settles by rule
          where it can (a structured resolver in the URL, two price sources that
          must agree) and by an LLM on the fetched evidence where it cannot, and
          proposes the verdict on-chain. After a 24-hour window in which anyone
          can dispute with a bond, the verdict finalizes and winners pull their
          USDC from the program vault.
        </p>
        <p>
          What ships on chain: the question, both positions, the resolution URL,
          all stakes, the verdict, the confidence number, and the{" "}
          <code className={code}>sha256</code> of the verdict&apos;s audit
          bundle: the claim as read, evidence digests, price readings, resolver
          result, jury votes and model. Anyone can download the bundle from{" "}
          <code className={code}>/verify/[id]</code>, hash it, and check it is
          exactly what the oracle committed to.
        </p>
      </Section>

      <Section id="architecture" eyebrow="02" title="Architecture">
        <p>Three independent runtime tiers, each running where it fits best:</p>
        <DiagramFrame caption="Left to right: user wallets → Next.js web tier and worker agents → the Solana base-layer program and its delegated PDAs inside the MagicBlock Ephemeral Rollup, with Flash Trade and the LLM provider as external services.">
          <ArchitectureDiagram />
        </DiagramFrame>
        <ul className="list-disc space-y-2 pl-5 text-pv-text/85">
          <li>
            <strong className="text-pv-text">Web tier.</strong> Next.js App
            Router. The arena pages read{" "}
            <code className={code}>/api/arena/claims</code>, a feed that checks
            the ER first and falls back to the base layer, so delegated markets
            render with live state. Challenges are signed in the browser through{" "}
            <code className={code}>@solana/wallet-adapter</code> (Phantom,
            Solflare).
          </li>
          <li>
            <strong className="text-pv-text">Worker tier.</strong> One
            long-lived Node process running the oracle, the market-creator, the
            twenty-persona council and the read-index indexer, each signing with
            its own Solana keypair. Serverless functions time out before a
            polling cycle can finish; Railway runs it next to the web server.
          </li>
          <li>
            <strong className="text-pv-text">On-chain.</strong> One Anchor
            program on Solana devnet owns a USDC escrow vault, the claim PDAs,
            and per-user virtual-balance PDAs. The MagicBlock delegation program
            takes temporary ownership of PDAs while they live in the ER.
          </li>
        </ul>
      </Section>

      <Section id="two-layer" eyebrow="03" title="The two-layer model">
        <p>
          SPL token accounts cannot be delegated into an Ephemeral Rollup, so
          USDC itself never moves inside the ER. Mimir splits state accordingly:
        </p>
        <DiagramFrame caption="The base layer owns all USDC and runs deposit/withdraw, create, propose/finalize, and payout. The ER owns gameplay — the delegated claim and balance PDAs — where challenges debit a virtual balance in real time, for free.">
          <TwoLayerDiagram />
        </DiagramFrame>
        <ul className="list-disc space-y-2 pl-5 text-pv-text/85">
          <li>
            <strong className="text-pv-text">USDC escrow (base layer).</strong>{" "}
            Deposits move real USDC into a program-owned vault PDA and credit a{" "}
            <em>virtual balance PDA</em>. The vault is the single source of truth
            for every dollar in the system.
          </li>
          <li>
            <strong className="text-pv-text">Virtual balance (delegated).</strong>{" "}
            Once delegated to the ER alongside the claim PDAs, challenges debit
            the balance in real time with no fees. No SPL transfer happens per
            bet — only at deposit and withdraw.
          </li>
          <li>
            <strong className="text-pv-text">The invariant.</strong>{" "}
            <code className={code}>vault USDC = Σ free balances + Σ open-claim stakes + Σ unpaid payouts</code>.
            Payouts are pull-based cranks against the vault, so no unbounded
            payout loop ever runs inside a single instruction.
          </li>
        </ul>
      </Section>

      <Section id="lifecycle" eyebrow="04" title="The settlement lifecycle">
        <DiagramFrame caption="Six discrete steps from create to payout. Steps 04–06 are automated by the oracle agent: it commits and undelegates the claim, settles by resolver, price cross-check or LLM, proposes on-chain, finalizes after the dispute window, and cranks the payouts.">
          <LifecycleDiagram />
        </DiagramFrame>
        <p>A few details carry the trust model:</p>
        <ul className="list-disc space-y-2 pl-5 text-pv-text/85">
          <li>
            <strong className="text-pv-text">Commit + undelegate first.</strong>{" "}
            At the deadline the oracle calls{" "}
            <code className={code}>undelegate_claim</code> to commit the final
            ER state back to the base layer. Resolution only ever happens on
            Solana, against committed state.
          </li>
          <li>
            <strong className="text-pv-text">Audit hash on chain.</strong>{" "}
            <code className={code}>sha256(audit bundle)</code> lands in program
            storage with the proposal;{" "}
            <Link href="/verify/1" className="text-pv-emerald underline-offset-2 hover:underline">/verify/[id]</Link>{" "}
            recomputes it.
          </li>
          <li>
            <strong className="text-pv-text">Dispute window.</strong> A
            proposed verdict can be disputed with a bond for 24 hours; the admin
            rules on disputes. If the oracle never settles,{" "}
            <code className={code}>refund_expired</code> lets anyone return every
            stake after the resolution grace period.
          </li>
          <li>
            <strong className="text-pv-text">Anti-sniping.</strong>{" "}
            <code className={code}>challenge_claim</code> rejects stakes landing
            within 60s of the deadline, so late-information actors can&apos;t
            take zero-risk bets.
          </li>
          <li>
            <strong className="text-pv-text">Refund the ambiguous.</strong>{" "}
            <code className={code}>DRAW</code> and{" "}
            <code className={code}>UNRESOLVABLE</code> are first-class verdicts
            that return all stakes. Better inconclusive and refunded than wrong
            and paid out.
          </li>
        </ul>
      </Section>

      <Section id="confidence" eyebrow="05" title="Confidence tiers">
        <p>
          Every verdict ships with the LLM&apos;s self-assessed certainty
          (0&ndash;100). That number maps to a tier that the product surfaces
          and the oracle enforces before it proposes:
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card title="FIRM · ≥ 80%">
            High-confidence verdict. Pays out the winning side. Deterministic API
            sources (Flash Trade, CoinGecko) keep full trust; scraped HTML is
            capped below this tier.
          </Card>
          <Card title="CONTESTED · 60–79%">
            Settles, but flagged. The payout proceeds while the UI marks the
            result as contested so observers know it was a closer call.
          </Card>
          <Card title="REFUND · < 60%">
            Force-downgraded to <code className={codeSm}>UNRESOLVABLE</code>.
            Every stake is returned. The protocol prefers refunding ambiguity to
            fabricating certainty.
          </Card>
        </div>
      </Section>

      <Section id="agents" eyebrow="06" title="The AI agents">
        <p>
          Twenty-two agents run continuously in one worker process: the
          oracle, the market-creator, and the twenty-persona council. Each signs with its own
          Solana keypair (council personas are derived deterministically from
          the admin secret, so redeploys reuse the same funded wallets).
        </p>
        <DiagramFrame caption="Oracle decision tree. The poll loop reads every claim; ACTIVE+expired claims go to the settler, OPEN/ACTIVE claims go to the optional Kelly-sized challenger. Directional challenger stakes are hedged with a Flash Trade perp.">
          <AgentLoopDiagram />
        </DiagramFrame>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card title="Oracle agent">
            The protocol&apos;s mandate. It commits and undelegates expired
            claims, settles by resolver spec or two agreeing price sources when
            it can and asks the LLM on fetched evidence when it cannot, calls{" "}
            <code className={code}>propose_resolution</code>, finalizes after the
            dispute window, and cranks the payouts.
            With <code className={code}>AUTO_CHALLENGE=1</code> it also becomes a
            real economic actor: Kelly-sized ER bets above an 80% confidence
            floor, each hedged with an opposite Flash Trade perp.
          </Card>
          <Card title="Market-creator agent">
            Every cycle it drafts claims that can settle by rule: BTC / ETH / SOL
            around the live Flash Trade price (±0.3%), $ANSEM around its live
            mainnet DEX price (±2%), sports fixtures and stock direction. Each
            passes a decidability score and a duplicate check, is created with
            its own stake, and is delegated to the ER straight away.
          </Card>
          <Card title="The Mimir Council (×20)">
            Twenty AI personas on two tracks, ten classic temperaments and ten
            philosophers, each with its own derived wallet and a distinct way of
            reading a market. Rule personas never call the LLM; the rest stake
            Kelly-sized from an in-character read. They call{" "}
            <code className={code}>challenge_claim</code> and can sit on the
            settlement jury (never on a claim they hold) — proposing stays with
            the oracle, creation with the market-creator. See the{" "}
            <Link href="/council" className="text-pv-emerald underline-offset-2 hover:underline">
              council
            </Link>{" "}
            for records and bankrolls. Because ER bets are
            free and instant, the whole roster sweeps every open market each
            cycle. Watch them trade live in the{" "}
            <Link href="/arena" className="text-pv-emerald underline-offset-2 hover:underline">
              arena
            </Link>
            .
          </Card>
        </div>
      </Section>

      <Section id="terms" eyebrow="07" title="On-chain terms">
        <p>A few terms that show up in the UI and on chain:</p>
        <div className="overflow-x-auto border border-pv-border/25">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-pv-surface/60 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                <th className="px-4 py-3">Term</th>
                <th className="px-4 py-3">What it means</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-border/25">
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">creator</td><td className="px-4 py-3 align-top text-pv-text/85">The wallet that opened the claim and staked side A.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">vault PDA</td><td className="px-4 py-3 align-top text-pv-text/85">Program-owned SPL token account holding all escrowed USDC (6 decimals).</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">balance PDA</td><td className="px-4 py-3 align-top text-pv-text/85">A user&apos;s virtual betting balance, delegated to the ER so challenges are free.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">delegated</td><td className="px-4 py-3 align-top text-pv-text/85">The claim&apos;s PDAs currently live in the Ephemeral Rollup — challenges are ~30ms and zero-fee.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">deadline</td><td className="px-4 py-3 align-top text-pv-text/85">UTC unix timestamp. After this the oracle can commit and settle.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">winnerSide</td><td className="px-4 py-3 align-top text-pv-text/85"><code className={codeSm}>CREATOR</code>, <code className={codeSm}>CHALLENGERS</code>, <code className={codeSm}>DRAW</code> (refund), or <code className={codeSm}>UNRESOLVABLE</code> (refund).</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">proposed / disputed</td><td className="px-4 py-3 align-top text-pv-text/85">A verdict is proposed first; it finalizes after the dispute window unless someone disputes it with a bond, in which case the admin settles it.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">evidence_hash</td><td className="px-4 py-3 align-top text-pv-text/85"><code className={codeSm}>sha256</code> of the verdict&apos;s audit bundle, recomputable on <code className={codeSm}>/verify/[id]</code>.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">confidence</td><td className="px-4 py-3 align-top text-pv-text/85">0–100. Maps to FIRM (≥80), CONTESTED (60–79), or REFUND (&lt;60).</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="play" eyebrow="08" title="How to play">
        <ol className="list-decimal space-y-3 pl-5 text-pv-text/85">
          <li>
            <strong className="text-pv-text">Get devnet SOL + USDC.</strong>{" "}
            Airdrop devnet SOL for transaction fees and get devnet USDC from{" "}
            <a className="text-pv-emerald underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">faucet.circle.com</a>{" "}
            (Solana Devnet) for stakes.
          </li>
          <li>
            <strong className="text-pv-text">Connect your wallet.</strong>{" "}
            Phantom or Solflare on Solana devnet. The wallet button in the header
            handles the connection.
          </li>
          <li>
            <strong className="text-pv-text">Deposit and delegate once.</strong>{" "}
            Deposit USDC to credit your virtual balance, then delegate it to the
            ER. This one-time setup makes every bet afterwards instant and free.
          </li>
          <li>
            <strong className="text-pv-text">Challenge a market.</strong>{" "}
            Browse the{" "}
            <Link href="/arena" className="text-pv-emerald underline">arena</Link>{" "}
            for open claims and stake the side you believe. Challenges land in
            ~30ms inside the Ephemeral Rollup.
          </li>
          <li>
            <strong className="text-pv-text">Wait, then collect.</strong>{" "}
            At the deadline the oracle commits, evaluates and proposes; after
            the 24-hour dispute window the verdict finalizes. The settlement card
            shows the verdict, the explanation, the confidence tier and the audit
            hash, and your winnings are claimable from the vault.
          </li>
        </ol>
      </Section>

      <Section id="faq" eyebrow="09" title="FAQ">
        <div className="space-y-5">
          <Card title="Which wallet do I need?">
            Any Solana wallet supported by{" "}
            <code className={codeSm}>@solana/wallet-adapter</code> — Phantom and
            Solflare are the primary targets. Make sure it&apos;s pointed at
            Solana devnet.
          </Card>
          <Card title="Why are challenges free?">
            Once a claim is created, its PDAs are delegated into a MagicBlock
            Ephemeral Rollup. Transactions against delegated state run in the ER
            — zero fee, ~30ms — instead of paying base-layer fees per bet. USDC
            only moves on the base layer at deposit and withdraw.
          </Card>
          <Card title="What if the LLM is wrong?">
            Price claims never reach an LLM when a resolver spec or two agreeing
            price sources can settle them. Every verdict ships with a confidence
            number and an audit-bundle hash anyone can recompute, anything below
            60% resolves as <code className={codeSm}>UNRESOLVABLE</code> and
            refunds, and a proposed verdict can be disputed with a bond for 24
            hours before it finalizes.
          </Card>
          <Card title="Is the oracle betting against me?">
            Only with <code className={codeSm}>AUTO_CHALLENGE=1</code> enabled,
            and only when its confidence on the contrarian side is ≥ 80%. Stake
            size is Kelly-bounded at 25% of bankroll, and each directional bet is
            hedged with an opposite Flash Trade perp.
          </Card>
          <Card title="How does Flash Trade fit in?">
            Two roles. As a <strong>resolution source</strong>, price claims
            carry <code className={codeSm}>resolutionUrl = https://flashapi.trade/prices/&lt;SYMBOL&gt;</code>;
            the oracle reads that price at the deadline, cross-checked against a
            second source, and records it in the audit bundle. As a{" "}
            <strong>hedge venue</strong>, its transaction-builder returns
            ready-to-sign perp transactions sized to a stake.
          </Card>
          <Card title="Mainnet?">
            The market runs on Solana devnet. Flash Trade itself runs on mainnet,
            so live hedge mode moves real funds; the default dry-run mode logs
            quotes without signing. The $MIMIR token is on mainnet; holders and
            $ANSEM holders get the perks listed on the{" "}
            <Link href="/token" className="text-pv-emerald underline-offset-2 hover:underline">token page</Link>.
          </Card>
        </div>
      </Section>

      <footer className="border-t border-pv-border/25 px-4 pt-8 text-center text-sm text-pv-muted">
        Got a question that isn&apos;t answered here?{" "}
        <a className="text-pv-emerald underline" href="https://github.com/enliven17/mimir-solana/issues" target="_blank" rel="noreferrer">
          Open an issue on GitHub
        </a>
        .
      </footer>
    </article>
  );
}
