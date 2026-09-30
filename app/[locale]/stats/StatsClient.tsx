"use client";

/**
 * /stats body. Every number is read from the indexed claim feed at
 * /api/arena/claims (Neon read-index, chain fallback), polled every 5s while
 * the tab is visible; an unchanged body never re-renders.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SURFACE } from "@/components/arena/surface";
import Skeleton from "@/components/ui/Skeleton";
import { Strip, StripCell } from "@/components/ui/Strip";
import { usePolledJson } from "@/lib/usePolledJson";
import { formatUsdcUnitsBare as usdc } from "@/lib/money";
import { isPendingVerdict } from "@/lib/claim-status";

interface ClaimRow {
  id: number;
  question: string;
  category: string;
  creatorStake: string;
  totalChallengerStake: string;
  state: number;
  winnerSide: number;
  confidence: number;
  createdAt: number;
  delegated: boolean;
}

interface ClaimsData {
  claims: ClaimRow[];
  claimCount: number;
  totalResolved: number;
  openPool: string;
}

const SIDE_KEY: Record<number, string> = {
  0: "pending",
  1: "creator",
  2: "challengers",
  3: "draw",
  4: "unresolvable",
};

type Tier = "firm" | "contested" | "low";
const tierOf = (c: number): Tier => (c >= 80 ? "firm" : c >= 60 ? "contested" : "low");
const TIER_CLASS: Record<Tier, string> = {
  firm: "bg-coral/[0.16] text-pending",
  contested: "bg-cream/[0.08] text-cream",
  low: "bg-cream/[0.05] text-muted",
};

/** Rows rendered before "Show more": the feed can hold hundreds of claims. */
const PAGE_ROWS = 30;
const pctOf = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

function Bar({
  label,
  count,
  total,
  fill,
  loading = false,
}: {
  label: string;
  count: number;
  total: number;
  fill: string;
  /** Before the first answer: a dash, not "0 · 0%". */
  loading?: boolean;
}) {
  const pct = pctOf(count, total);
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-cream">{label}</span>
        <span className="font-mono tabular-nums text-muted">
          {loading ? "—" : `${count} · ${pct}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2" aria-hidden>
        <i
          className={`block h-full origin-left rounded-full transition-transform duration-500 ease-out ${fill}`}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
    </div>
  );
}

export default function StatsClient() {
  const t = useTranslations("stats");
  const [shown, setShown] = useState(PAGE_ROWS);

  const data = usePolledJson<ClaimsData>("/api/arena/claims", 5000, (json) => {
    const r = json as { success: boolean; data: ClaimsData };
    return r.success ? r.data : undefined;
  });

  const claims = data?.claims ?? [];
  const open = claims.filter((c) => c.state <= 1);
  const liveOnEr = open.filter((c) => c.delegated).length;
  // Prefer the API aggregate (covers claims not on this page), else sum what we have.
  const openPool =
    data && data.openPool !== "0"
      ? data.openPool
      : open.reduce((sum, c) => sum + Number(c.creatorStake) + Number(c.totalChallengerStake), 0).toString();

  const settlements = claims.filter((c) => c.state === 2).sort((a, b) => b.createdAt - a.createdAt);
  const settled = settlements.length;
  const pending = claims.filter((c) => isPendingVerdict(c.state)).length;
  const firm = settlements.filter((s) => s.confidence >= 80).length;
  const contested = settlements.filter((s) => s.confidence >= 60 && s.confidence < 80).length;
  const low = settlements.filter((s) => s.confidence < 60 && s.confidence > 0).length;
  const refunds = settlements.filter((s) => s.winnerSide === 3 || s.winnerSide === 4).length;
  const creatorWins = settlements.filter((s) => s.winnerSide === 1).length;
  const challengerWins = settlements.filter((s) => s.winnerSide === 2).length;
  const decided = creatorWins + challengerWins;
  const dash = <span className="text-dim">—</span>;

  return (
    <>
      <div className="grid gap-3">
        <Strip label={t("stripLabel")} className="overflow-hidden rounded-2xl">
          <StripCell label={t("openPool")} value={<span className="font-mono tabular-nums">{data ? usdc(openPool) : dash}</span>} live />
          <StripCell label={t("markets")} value={<span className="font-mono tabular-nums">{data ? data.claimCount : dash}</span>} />
          <StripCell label={t("resolved")} value={<span className="font-mono tabular-nums">{data ? data.totalResolved : dash}</span>} />
          <StripCell
            label={t("firmRate")}
            value={<span className="font-mono tabular-nums">{data ? `${pctOf(firm, settled)}%` : dash}</span>}
          />
        </Strip>
        <p className="m-0 min-h-[20px] text-[13px] text-muted">
          {data ? t("liveLine", { live: liveOnEr, open: open.length, pending }) : null}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="stats-confidence" className={`${SURFACE} grid content-start gap-5 p-5 sm:p-6`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="stats-confidence" className="m-0 font-display text-[1.45rem] leading-none text-cream">
              {t("confidence")}
            </h2>
            <span className="text-[13px] text-muted">{data ? t("refundRate", { pct: pctOf(refunds, settled) }) : null}</span>
          </div>
          <Bar label={t("tier.firm")} count={firm} total={settled} loading={!data} fill="bg-coral" />
          <Bar label={t("tier.contested")} count={contested} total={settled} loading={!data} fill="bg-cream/60" />
          <Bar label={t("tier.low")} count={low} total={settled} loading={!data} fill="bg-dim" />
        </section>

        <section aria-labelledby="stats-won" className={`${SURFACE} grid content-start gap-5 p-5 sm:p-6`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="stats-won" className="m-0 font-display text-[1.45rem] leading-none text-cream">
              {t("whoWon")}
            </h2>
            <span className="text-[13px] text-muted">{data ? t("decided", { count: decided }) : null}</span>
          </div>
          {decided > 0 ? (
            <>
              <div className="flex h-2 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                <i className="block h-full bg-coral" style={{ width: `${pctOf(creatorWins, decided)}%` }} />
                <i className="block h-full bg-cream/60" style={{ width: `${pctOf(challengerWins, decided)}%` }} />
              </div>
              <dl className="m-0 grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-[13px] text-muted">{t("creatorWins")}</dt>
                  <dd className="m-0 mt-1 font-mono text-[1.6rem] leading-none tabular-nums text-cream">
                    {creatorWins} <span className="text-[13px] text-muted">{pctOf(creatorWins, decided)}%</span>
                  </dd>
                </div>
                <div className="text-right">
                  <dt className="text-[13px] text-muted">{t("challengerWins")}</dt>
                  <dd className="m-0 mt-1 font-mono text-[1.6rem] leading-none tabular-nums text-cream">
                    {challengerWins} <span className="text-[13px] text-muted">{pctOf(challengerWins, decided)}%</span>
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="m-0 text-[14px] text-muted">{data ? t("noDecided") : t("loading")}</p>
          )}
        </section>
      </div>

      <section aria-labelledby="stats-recent" className="grid gap-3">
        <h2 id="stats-recent" className="m-0 font-display text-[1.45rem] leading-none text-cream">
          {t("recent")}
        </h2>
        <div className={SURFACE}>
          {!data ? (
            <div className="grid gap-4 p-5" aria-label={t("loading")}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="!h-10" />
              ))}
            </div>
          ) : settlements.length === 0 ? (
            <p className="m-0 p-8 text-center text-[14px] text-muted">{t("empty")}</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {settlements.slice(0, shown).map((s) => {
                const tier = tierOf(s.confidence);
                return (
                  <li key={s.id} className="[contain-intrinsic-size:auto_76px] [content-visibility:auto]">
                    <Link
                      href={`/arena/${s.id}`}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-cream/[0.03]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="m-0 line-clamp-2 text-[15px] leading-snug text-cream">{s.question}</p>
                        <p className="m-0 mt-1 text-[13px] text-muted">
                          <span className="font-mono">#{s.id}</span> · {s.category} ·{" "}
                          {t(`side.${SIDE_KEY[s.winnerSide] ?? "unknown"}`)}
                        </p>
                      </div>
                      <span
                        className={`flex-none whitespace-nowrap rounded-full px-3 py-1 text-[12px] ${TIER_CLASS[tier]}`}
                      >
                        {t(`tier.${tier}`)} <span className="font-mono tabular-nums">{s.confidence}%</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {settlements.length > shown ? (
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE_ROWS)}
            className="btn-ghost !min-h-[46px] !w-auto justify-self-center !px-5 !text-[15px]"
          >
            {t("showMore", { count: settlements.length - shown })}
          </button>
        ) : null}
      </section>
    </>
  );
}
