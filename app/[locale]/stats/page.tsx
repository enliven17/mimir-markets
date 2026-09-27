"use client";

/**
 * /stats — Mimir on Solana: live on-chain analytics.
 *
 * Every number here is read from the indexed claim feed at /api/arena/claims
 * (Neon read-index, kept warm by the indexer; chain fallback otherwise). The
 * page never touches the chain or DB directly — it polls the JSON API every 5s
 * so headline tiles, the confidence breakdown, and the settlement timeline all
 * stay fresh while the council settles markets.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatUsdcUnitsBare as usdc } from "@/lib/money";

interface Challenger {
  addr: string;
  stake: string;
  paid: boolean;
}

interface ClaimRow {
  id: number;
  creator: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  creatorStake: string;
  totalChallengerStake: string;
  deadline: number;
  state: number;
  winnerSide: number;
  resolutionSummary: string;
  confidence: number;
  createdAt: number;
  maxChallengers: number;
  delegated: boolean;
  challengers: Challenger[];
}

interface ClaimsData {
  claims: ClaimRow[];
  claimCount: number;
  totalResolved: number;
  openPool: string;
}

interface ClaimsResponse {
  success: boolean;
  source: string;
  data: ClaimsData;
}

const SIDE_LABEL: Record<number, { label: string; color: string }> = {
  0: { label: "Pending", color: "text-pv-muted" },
  1: { label: "Creator won", color: "text-pv-emerald" },
  2: { label: "Challengers won", color: "text-pv-fuch" },
  3: { label: "Draw · refunded", color: "text-pv-muted" },
  4: { label: "Unresolvable · refunded", color: "text-amber-600" },
};

function tierLabel(c: number): { label: string; cls: string } {
  if (c >= 80)
    return {
      label: "FIRM",
      cls: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald",
    };
  if (c >= 60)
    return {
      label: "CONTESTED",
      cls: "border-pv-border/60 bg-pv-surface2/60 text-pv-text/80",
    };
  return {
    label: "LOW",
    cls: "border-amber-400/40 bg-amber-400/[0.10] text-amber-700",
  };
}

function Kpi({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "accent";
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        tone === "accent"
          ? "border-pv-emerald/35 bg-pv-emerald/[0.06]"
          : "border-pv-border/30 bg-pv-surface/70"
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-pv-muted">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-2xl font-bold tracking-tight tabular-nums ${
          tone === "accent" ? "text-pv-emerald" : "text-pv-text"
        }`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] text-pv-muted">{sub}</div>
      ) : null}
    </div>
  );
}

function ConfidenceBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-bold uppercase tracking-[0.16em] text-pv-text/85">
          {label}
        </span>
        <span className="font-mono text-pv-muted">
          {count} · {pct}%
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-pv-surface2/60">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function StatsPage() {
  const { locale } = useParams<{ locale: string }>();
  const [data, setData] = useState<ClaimsData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/arena/claims");
        const json: ClaimsResponse = await res.json();
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

  const claims = data?.claims ?? [];
  const totalMarkets = data?.claimCount ?? 0;
  const totalResolved = data?.totalResolved ?? 0;
  const openNow = claims.filter((c) => c.state <= 1).length;
  const liveOnEr = claims.filter((c) => c.delegated && c.state <= 1).length;

  // Open pool: prefer the API aggregate (covers claims not on this page),
  // else sum the open/active claims we have.
  const openPoolUnits =
    data && data.openPool !== "0"
      ? data.openPool
      : claims
          .filter((c) => c.state <= 1)
          .reduce(
            (sum, c) =>
              sum + Number(c.creatorStake) + Number(c.totalChallengerStake),
            0
          )
          .toString();

  const settlements = claims
    .filter((c) => c.state === 2)
    .sort((a, b) => b.createdAt - a.createdAt);

  const settledCount = settlements.length;
  const firm = settlements.filter((s) => s.confidence >= 80).length;
  const contested = settlements.filter(
    (s) => s.confidence >= 60 && s.confidence < 80
  ).length;
  const low = settlements.filter(
    (s) => s.confidence < 60 && s.confidence > 0
  ).length;
  const accuracyPct =
    settledCount > 0 ? Math.round((firm / settledCount) * 100) : 0;

  const creatorWins = settlements.filter((s) => s.winnerSide === 1).length;
  const challengerWins = settlements.filter((s) => s.winnerSide === 2).length;
  const decided = creatorWins + challengerWins;
  const refunds = settlements.filter(
    (s) => s.winnerSide === 3 || s.winnerSide === 4
  ).length;
  const refundPct =
    settledCount > 0 ? Math.round((refunds / settledCount) * 100) : 0;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-pv-emerald">
          Oracle Analytics
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">
          Live on-chain stats <span className="text-pv-emerald">· Solana</span>
        </h1>
        <p className="text-sm text-pv-muted">
          Every number is read from the Mimir program on Solana. Claims
          delegated to the{" "}
          <span className="font-medium text-pv-emerald">
            MagicBlock Ephemeral Rollup
          </span>{" "}
          settle in ~30ms. This page polls every 5 seconds.
        </p>
      </header>

      {/* Headline KPIs */}
      <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          tone="accent"
          label="Open pool"
          value={`${usdc(openPoolUnits)} USDC`}
          sub="creator + challenger stakes"
        />
        <Kpi
          label="Total markets"
          value={data ? totalMarkets : "…"}
          sub={`${openNow} open now`}
        />
        <Kpi
          label="Resolved"
          value={data ? totalResolved : "…"}
          sub={`${settledCount} shown here`}
        />
        <Kpi
          label="Live on ER"
          value={data ? liveOnEr : "…"}
          sub="delegated · zero-fee"
        />
        <Kpi
          label="Oracle accuracy"
          value={`${accuracyPct}%`}
          sub="settlements at ≥ 80% confidence"
        />
      </section>

      {/* Confidence distribution + decided split */}
      <section className="mb-10 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-5 sm:p-6">
          <h2 className="mb-1 font-display text-base font-bold tracking-tight text-pv-text">
            Oracle confidence distribution
          </h2>
          <p className="mb-5 text-xs text-pv-muted">
            How sure the oracle was when it settled. Mimir refunds the bottom
            band rather than guess. Refund rate:{" "}
            <span className="font-mono text-pv-text/80">{refundPct}%</span>.
          </p>
          <div className="space-y-4">
            <ConfidenceBar
              label="FIRM · ≥ 80%"
              count={firm}
              total={settledCount}
              color="#34d399"
            />
            <ConfidenceBar
              label="CONTESTED · 60-79"
              count={contested}
              total={settledCount}
              color="#a3e635"
            />
            <ConfidenceBar
              label="LOW · refunded"
              count={low}
              total={settledCount}
              color="#E8C46C"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-5 sm:p-6">
          <h2 className="mb-1 font-display text-base font-bold tracking-tight text-pv-text">
            Decided settlements · who won
          </h2>
          <p className="mb-5 text-xs text-pv-muted">
            Excludes draws and unresolvable claims, which are refunded.
          </p>
          {decided > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-pv-emerald/30 bg-pv-emerald/[0.05] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-emerald">
                  Creator wins
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold tabular-nums text-pv-text">
                    {creatorWins}
                  </span>
                  <span className="text-xs text-pv-muted">
                    {Math.round((creatorWins / decided) * 100)}%
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-pv-border/40 bg-pv-surface2/40 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-fuch">
                  Challenger wins
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold tabular-nums text-pv-text">
                    {challengerWins}
                  </span>
                  <span className="text-xs text-pv-muted">
                    {Math.round((challengerWins / decided) * 100)}%
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-pv-muted">No decided settlements yet.</p>
          )}
        </div>
      </section>

      {/* Recent settlements feed */}
      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-pv-text">
          Recent settlements
        </h2>
        {!data ? (
          <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-8 text-center text-sm text-pv-muted">
            Loading on-chain settlements…
          </div>
        ) : settlements.length === 0 ? (
          <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-8 text-center text-sm text-pv-muted">
            No settlements yet. Once the oracle resolves a claim, it appears
            here.
          </div>
        ) : (
          <div className="space-y-3">
            {settlements.map((s) => {
              const side = SIDE_LABEL[s.winnerSide] ?? {
                label: "Unknown",
                color: "text-pv-muted",
              };
              const tier = tierLabel(s.confidence);
              return (
                <Link
                  key={s.id}
                  href={`/${locale}/arena/${s.id}`}
                  className="group block rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-4 transition-colors hover:border-pv-emerald/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-mono text-pv-muted">
                          Claim #{s.id}
                        </span>
                        <span className="rounded-full bg-pv-surface2/60 px-2 py-0.5 font-medium uppercase tracking-wide text-pv-muted">
                          {s.category}
                        </span>
                        <span className={`font-bold ${side.color}`}>
                          {side.label}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 font-bold uppercase tracking-[0.14em] ${tier.cls}`}
                        >
                          {tier.label} · {s.confidence}%
                        </span>
                      </div>
                      <h3 className="font-medium leading-snug text-pv-text group-hover:text-pv-emerald">
                        {s.question}
                      </h3>
                      {s.resolutionSummary && (
                        <p className="mt-1.5 line-clamp-2 text-[13px] text-pv-text/75">
                          {s.resolutionSummary}
                        </p>
                      )}
                      {s.resolutionUrl && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="font-mono text-[10px] uppercase tracking-wide text-pv-muted">
                            Evidence:
                          </span>
                          <span className="max-w-[320px] truncate font-mono text-[10px] text-pv-emerald/85">
                            {s.resolutionUrl}
                          </span>
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 self-start rounded-lg border border-pv-border/40 px-2 py-1 text-[11px] text-pv-muted transition-colors group-hover:border-pv-emerald group-hover:text-pv-emerald">
                      View →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="text-center">
        <Link
          href={`/${locale}/arena`}
          className="text-sm text-pv-muted transition-colors hover:text-pv-text"
        >
          ← Back to the Arena
        </Link>
      </div>
    </main>
  );
}
