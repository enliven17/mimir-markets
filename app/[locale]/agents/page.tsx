"use client";

/**
 * /agents — the Mimir council: a persona-card grid of the AI economic actors,
 * driven entirely by Solana data.
 *
 * The original /council layout: eyebrow + big title + description + a row of
 * stat chips, then a responsive PersonaCard grid, then a bottom nav. We keep
 * the client-side 5s poll against /api/arena/agents and render that layout.
 * The page never touches the chain, the DB, or any server-only persona module.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatUsdcUnitsBare as usdc } from "@/lib/money";

interface Persona {
  slug: string;
  displayName: string;
  emoji: string;
  bio: string;
  archetype: string;
  address: string;
  stakes: number;
  volume: string;
  balance?: string;
  categoryFilter?: string[];
}

interface OracleAgent {
  address: string;
  stakes: number;
  volume: number;
}

interface ActivityRow {
  kind: "challenge" | "settle";
  claimId: number;
  question: string;
  actor: string;
  label: string;
  emoji: string;
  stake?: string;
  confidence?: number;
}

interface AgentsData {
  oracle: OracleAgent;
  personas: Persona[];
  activity: ActivityRow[];
}

interface AgentsResponse {
  success: boolean;
  data: AgentsData;
}

/** Solana base58 pubkeys: first4…last4. */
function shortAddr(a: string): string {
  if (!a || a.length <= 8) return a || "—";
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function explorerAddressUrl(a: string): string {
  return `https://explorer.solana.com/address/${a}?cluster=devnet`;
}

const ARCHETYPE_LABEL: Record<string, string> = {
  "llm-biased": "LLM · biased",
  "rule-based": "Rule · no LLM",
  specialist: "Specialist · category-filtered",
  micro: "Micro · low threshold",
};

// ── Persona card (reproduced verbatim from archive council page) ───────────────

function PersonaCard({
  persona,
  recentBets,
  locale,
}: {
  persona: Persona;
  recentBets: ActivityRow[];
  locale: string;
}) {
  const active = persona.stakes > 0;

  return (
    <article className="flex h-full flex-col gap-4 rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-5 transition-colors hover:border-pv-border/60">
      <header className="flex items-start gap-3">
        <span className="text-2xl leading-none grayscale opacity-75">{persona.emoji}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-bold tracking-tight text-pv-text">
            {persona.displayName}
          </h3>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-pv-muted">
            {ARCHETYPE_LABEL[persona.archetype] ?? persona.archetype}
          </p>
        </div>
      </header>

      <p className="text-[12px] leading-relaxed text-pv-text/75">{persona.bio}</p>

      {persona.categoryFilter && persona.categoryFilter.length > 0 && (
        <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
          {persona.categoryFilter.map((c) => (
            <span key={c} className="rounded border border-pv-border/40 px-1.5 py-0.5">{c}</span>
          ))}
        </div>
      )}

      <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-pv-border/30 pt-3 text-center">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">balance</dt>
          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
            {usdc(persona.balance ?? "0")}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">stakes</dt>
          <dd className={`mt-0.5 font-display text-sm font-bold tabular-nums ${active ? "text-pv-emerald" : "text-pv-text"}`}>
            {persona.stakes}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">at risk</dt>
          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
            {usdc(persona.volume)}
          </dd>
        </div>
      </dl>

      {recentBets.length > 0 ? (
        <ul className="space-y-1.5 border-t border-pv-border/30 pt-3">
          {recentBets.map((b, i) => (
            <li key={`${b.claimId}-${i}`} className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
              <Link href={`/${locale}/arena/${b.claimId}`} className="text-pv-emerald hover:underline">
                claim #{b.claimId}
              </Link>
              <span className="tabular-nums text-pv-text/85">{usdc(b.stake ?? "0")} USDC</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-pv-border/30 pt-3 text-center font-mono text-[10px] italic text-pv-muted">
          no bets yet — waiting for an in-character market
        </p>
      )}

      <a
        href={explorerAddressUrl(persona.address)}
        target="_blank"
        rel="noreferrer"
        className="text-center font-mono text-[10px] text-pv-muted hover:text-pv-emerald"
      >
        {shortAddr(persona.address)} ↗
      </a>
    </article>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { locale } = useParams<{ locale: string }>();
  const [data, setData] = useState<AgentsData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/arena/agents");
        const json: AgentsResponse = await res.json();
        if (alive && json.success) setData(json.data);
      } catch {
        // keep last good state
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const personas = data?.personas ?? [];
  const oracle = data?.oracle;
  const activity = data?.activity ?? [];

  // Recent challenges grouped by actor address (newest-first already).
  function recentBetsFor(address: string): ActivityRow[] {
    if (!address) return [];
    return activity
      .filter((a) => a.kind === "challenge" && a.actor === address)
      .slice(0, 3);
  }

  // Header chips: active personas, total stakes, total at-risk.
  const activeCount = personas.filter((p) => p.stakes > 0).length;
  const totalStakes = personas.reduce((acc, p) => acc + p.stakes, 0);
  const totalAtRisk = personas.reduce((acc, p) => acc + Number(p.volume), 0);
  const totalBankroll = personas.reduce(
    (acc, p) => acc + Number(p.balance ?? "0"),
    0,
  );

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10 space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-pv-emerald">
          The Mimir Council
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">
          AI personas. Derived Solana wallets. One market.
        </h1>
        <p className="max-w-2xl text-sm text-pv-muted">
          Each persona reads the same claims and the same evidence but reaches different
          verdicts based on character — optimists tilt up, doomers tilt down, contrarians
          chase imbalance, specialists only touch their domain. Every stake below is a real
          on-chain transaction signed by the persona&apos;s own derived wallet on the
          MagicBlock Ephemeral Rollup. This page polls every 5 seconds.
        </p>
        {data && personas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 font-mono text-[11px] uppercase tracking-[0.16em]">
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              {activeCount} active
            </span>
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              {totalStakes} stakes
            </span>
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              <span className="tabular-nums text-pv-text">{usdc(String(totalAtRisk))}</span> usdc at risk
            </span>
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              bankroll <span className="tabular-nums text-pv-text">{usdc(String(totalBankroll))}</span> usdc
            </span>
          </div>
        )}
      </header>

      {/* Oracle strip — the settler that the original council page didn't have. */}
      {oracle && (
        <article className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-pv-emerald/35 bg-pv-emerald/[0.05] p-5">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="text-2xl leading-none">🔮</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-bold tracking-tight text-pv-text">
                  Oracle
                </h3>
                <span className="rounded border border-pv-emerald/40 bg-pv-emerald/[0.10] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-pv-emerald">
                  settler
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-pv-text/80">
                Reads expired claims, fetches evidence, asks an LLM, and settles
                on-chain. Refunds rather than guess on low confidence.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-center">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-emerald/80">
                stakes
              </div>
              <div className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
                {oracle.stakes}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-emerald/80">
                volume
              </div>
              <div className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
                {usdc(String(oracle.volume))}
              </div>
            </div>
            <a
              href={explorerAddressUrl(oracle.address)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] text-pv-muted hover:text-pv-emerald"
            >
              {shortAddr(oracle.address)} ↗
            </a>
          </div>
        </article>
      )}

      {!data ? (
        <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-12 text-center">
          <p className="text-base text-pv-text">Loading the council…</p>
        </div>
      ) : personas.length === 0 ? (
        <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-12 text-center">
          <p className="text-base text-pv-text">No agent activity yet.</p>
          <p className="mt-2 text-sm text-pv-muted">
            Once the council stakes or the oracle settles, the roster fills in here.
          </p>
        </div>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {personas.map((p) => (
            <PersonaCard
              key={p.slug}
              persona={p}
              recentBets={recentBetsFor(p.address)}
              locale={locale}
            />
          ))}
        </section>
      )}

      <nav className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
        <Link href={`/${locale}/arena`} className="text-pv-muted transition-colors hover:text-pv-text">
          ← live arena
        </Link>
        <Link href={`/${locale}/stats`} className="text-pv-muted transition-colors hover:text-pv-text">
          aggregate stats →
        </Link>
      </nav>
    </main>
  );
}
