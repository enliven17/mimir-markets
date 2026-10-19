"use client";

/**
 * One launch agent's page. Anyone sees its face, its token (live chart, a buy link) and its two wallets; its record,
 * trades and reasoning log are for $MIMIR holders (/api/launch/:id/detail checks the signed holder proof).
 */
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { api } from "@/convex/_generated/api";
import { ExternalMark } from "@/components/ExternalMark";
import { holderProofHeaders, useHolderTier } from "@/components/token/useHolderTier";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { Strip, StripCell } from "@/components/ui/Strip";
import { Link } from "@/i18n/navigation";
import { argusTokenUrl } from "@/lib/launch/argus";
import { type CouncilAgent, pumpFun, rhExplorer, rhToken, solscan } from "@/lib/launch/council-view";
import TokenChart from "./TokenChart";
import AgentFace from "./AgentFace";
import CopyPanel from "./CopyPanel";
import OwnerControls from "./OwnerControls";
import FeesBlock from "./FeesBlock";
import WalletsBlock from "./WalletsBlock";

type Council = CouncilAgent & { displayName: string; bio: string };
type Bet = { kind: string; marketId: number; label: string; question: string; usdc: number; outcome: "open" | "won" | "lost" | "refunded"; pnl: number };
type Detail = {
  agent: null | {
    chain?: string;
    events: { at: number; kind: string; text: string; chain: string | null; tx: string | null }[];
    solana: { pnlLamports: string; wins: number; losses: number; trades: number; open: { mint: string; symbol: string; costLamports: string }[] };
    recentTrades: { mint: string; side: string; lamports: string; sig: string; pnlLamports: string | null; reason: string; at: number }[];
  };
  arc: Bet[];
};

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const sol = (l: string | bigint) => (Number(BigInt(l)) / 1e9).toFixed(3);
const usd = (n: number) => `${n < 0 ? "-" : n > 0 ? "+" : ""}${Math.abs(n).toFixed(2)}`;

export default function LaunchAgentView({ slug, council }: { slug: string; council: Council | null }) {
  const t = useTranslations("launch");
  const card = useQuery(api.launch.card, council ? "skip" : { slug });
  const [chart, setChart] = useState<"solana" | "arc">("solana");
  if (!council && card === undefined) return <Skeleton className="h-72 w-full rounded-2xl" />;
  if (!council && !card) return <EmptyState>{t("notFound")}</EmptyState>;

  const a = council
    ? { name: council.displayName, ticker: council.ticker, seed: slug, about: council.bio, mint: council.mint, argus: council.argus, wallet: council.solana, robinhood: council.robinhood, arc: council.arc, house: true, venue: "solana" }
    : { name: card!.name, ticker: card!.ticker, seed: card!.avatarSeed, about: card!.thesis, mint: card!.mint, argus: card!.token ? { token: card!.token.address, poolId: card!.token.poolId } : null, wallet: card!.wallet, robinhood: null as string | null, arc: card!.arc, house: false, venue: card!.chain };
  const rh = a.venue === "robinhood";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <Link href="/launch" className="text-[14px] text-muted hover:text-cream">
        ← {t("title")}
      </Link>
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5">
        <AgentFace seed={a.seed} size={96} className="rounded-2xl shadow-[inset_0_0_0_1px_rgb(243_234_214/.08)] max-sm:!h-[72px] max-sm:!w-[72px] sm:row-span-2" />
        <div className="grid min-w-0 gap-1.5 sm:self-end">
          <h1 className="m-0 font-display text-app-h1 leading-none text-cream">{a.name}</h1>
          <p className="m-0 text-[14px] text-muted">
            <span className="mr-2 font-mono text-coral">${a.ticker}</span>
            {a.house ? t("councilBadge") : null}
          </p>
        </div>
        {a.about ? <p className="col-span-2 m-0 max-w-[62ch] text-[15px] leading-relaxed text-muted sm:col-span-1 sm:col-start-2 sm:row-start-2 sm:self-start">{a.about}</p> : null}
        {a.mint || a.argus ? (
          <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:flex-col">
            {a.mint ? (
              <a href={rh ? rhToken(a.mint) : pumpFun(a.mint)} target="_blank" rel="noreferrer" className="btn-primary !min-h-[46px] !w-auto !px-5 !py-2.5 !text-[15px]">
                {t("buy", { ticker: a.ticker })} <ExternalMark />
              </a>
            ) : null}
            {a.argus ? (
              <a href={argusTokenUrl(a.argus.token)} target="_blank" rel="noreferrer" className={`${a.mint ? "btn-ghost" : "btn-primary"} !min-h-[46px] !w-auto !px-5 !py-2.5 !text-[15px]`}>
                {t("buyArgus", { ticker: a.ticker })} <ExternalMark />
              </a>
            ) : null}
          </div>
        ) : null}
      </header>

      <section className="grid gap-3" aria-label={t("chart")}>
        {a.mint && a.argus ? (
          // An agent can live on both chains (the council's Socrates is the example): one chart at a time.
          <div className="flex gap-2" role="tablist" aria-label={t("chart")}>
            {(["solana", "arc"] as const).map((c) => (
              <button key={c} type="button" role="tab" aria-selected={chart === c} onClick={() => setChart(c)} className={`rounded-full px-4 py-2 text-[13px] ${chart === c ? "bg-cream text-ink" : "bg-cream/[0.06] text-muted hover:text-cream"}`}>
                {c === "solana" ? (rh ? "Robinhood · Pons" : "Solana · pump.fun") : "Arc · Argus"}
              </button>
            ))}
          </div>
        ) : null}
        {a.mint || a.argus ? (
          <div className="overflow-hidden rounded-2xl bg-ink-deep shadow-card">
            {a.mint && (!a.argus || chart === "solana") ? (
              <TokenChart key="main" chain={rh ? "robinhood" : "solana"} token={a.mint} title={t("chart")} tradeUrl={rh ? rhToken(a.mint) : pumpFun(a.mint)} tradeLabel={rh ? "Trade on Pons" : "Trade on pump.fun"} />
            ) : (
              <TokenChart key="arc" chain="arc" token={a.argus!.token} title={t("chartArgus")} tradeUrl={argusTokenUrl(a.argus!.token)} tradeLabel="Trade on Argus" />
            )}
          </div>
        ) : (
          <EmptyState>{t("noToken")}</EmptyState>
        )}
      </section>

      <WalletsBlock
        ticker={a.ticker} mint={a.mint} argus={a.argus?.token ?? null} venue={a.venue} arc={a.arc}
        // A Robinhood agent's trading wallet is on Robinhood Chain; the council has both.
        solana={rh ? null : a.wallet} robinhood={rh ? a.wallet : a.robinhood}
      />

      {!a.house && card ? <OwnerControls slug={slug} owner={card.owner} status={card.status} venue={a.venue} /> : null}
      {!a.house && card && a.venue !== "robinhood" ? <FeesBlock slug={slug} ticker={a.ticker} owner={card.owner} /> : null}
      <CopyPanel slug={slug} ticker={a.ticker} />
      <HolderSection slug={slug} />
    </div>
  );
}

function HolderSection({ slug }: { slug: string }) {
  const t = useTranslations("launch");
  const { wallet, proven, canSign, prove } = useHolderTier();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [gate, setGate] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet || !proven) return;
    let live = true;
    fetch(`/api/launch/${slug}/detail`, { headers: holderProofHeaders(wallet) })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) setDetail(body as Detail);
        else setGate((body as { error?: string }).error ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [wallet, proven, slug]);

  if (!detail) {
    return (
      <section className="grid justify-items-start gap-3 rounded-2xl bg-cream/[0.04] p-5">
        <h2 className="m-0 font-display text-[1.4rem] text-cream">{t("recordTitle")}</h2>
        <p className="m-0 max-w-[60ch] text-[14px] text-muted">{gate ?? t("gate")}</p>
        <div className="flex flex-wrap items-center gap-4">
          {wallet && !proven && canSign ? (
            <button type="button" onClick={() => void prove().catch(() => undefined)} className="btn-primary !w-auto !px-5">
              {t("prove")}
            </button>
          ) : null}
          {!wallet ? <span className="text-[14px] text-cream">{t("connect")}</span> : null}
          <Link href="/token" className="text-[14px] text-coral hover:underline">
            {t("getMimir")} →
          </Link>
        </div>
      </section>
    );
  }

  const bets = detail.arc;
  const won = bets.filter((b) => b.outcome === "won").length;
  const lost = bets.filter((b) => b.outcome === "lost").length;
  const s = detail.agent?.solana;
  const rhAgent = detail.agent?.chain === "robinhood";
  const unit = rhAgent ? "ETH" : "SOL";
  return (
    <section className="grid gap-5">
      <h2 className="m-0 font-display text-[1.4rem] text-cream">{t("recordTitle")}</h2>
      <Strip label={t("recordTitle")} className="overflow-hidden rounded-2xl">
        <StripCell label={t("arcStakes")} value={bets.length} />
        <StripCell label={t("winRate")} value={won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : "-"} />
        <StripCell label={t("arcPnl")} value={`${usd(bets.reduce((x, b) => x + b.pnl, 0))} USDC`} />
        <StripCell label={t("atRisk")} value={`${bets.filter((b) => b.outcome === "open").reduce((x, b) => x + b.usdc, 0).toFixed(2)} USDC`} />
        {s ? <StripCell label={t("solPnl")} value={`${sol(s.pnlLamports)} ${unit}`} /> : null}
        {s ? <StripCell label={t("solRecord")} value={`${s.wins}/${s.losses}`} /> : null}
      </Strip>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-2">
          <h3 className="m-0 text-[15px] text-cream">{t("stakesTitle")}</h3>
          {bets.length ? (
            <ul className="m-0 grid list-none gap-1.5 p-0 text-[13px]">
              {bets.slice(0, 15).map((b) => (
                <li key={`${b.kind}-${b.marketId}-${b.label}`} className="flex items-baseline justify-between gap-3">
                  <Link href={`/arena/arc/${b.kind}/${b.marketId}`} className="min-w-0 truncate text-muted hover:text-coral">
                    <span className="text-cream">{b.label}</span> · {b.question}
                  </Link>
                  <span className={`shrink-0 font-mono tabular-nums ${b.outcome === "won" ? "text-emerald-300" : b.outcome === "lost" ? "text-coral" : "text-muted"}`}>
                    {b.outcome === "open" || b.outcome === "refunded" ? `${b.usdc.toFixed(2)} · ${t(`outcome.${b.outcome}`)}` : usd(b.pnl)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-muted">{t("noStakes")}</p>
          )}
        </div>

        {detail.agent ? (
          <div className="grid content-start gap-2">
            <h3 className="m-0 text-[15px] text-cream">{t("tradesTitle")}</h3>
            {detail.agent.recentTrades.length ? (
              <ul className="m-0 grid list-none gap-1.5 p-0 text-[13px]">
                {detail.agent.recentTrades.map((tr) => (
                  <li key={tr.sig} className="flex items-baseline justify-between gap-3">
                    <a href={rhAgent ? rhExplorer("tx", tr.sig) : solscan("tx", tr.sig)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-muted hover:text-coral">
                      <span className="text-cream">{tr.side}</span> {short(tr.mint)} · {tr.reason}
                    </a>
                    <span className="shrink-0 font-mono tabular-nums text-cream">{sol(tr.pnlLamports ?? tr.lamports)} {unit}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-[13px] text-muted">{t("noTrades")}</p>
            )}
          </div>
        ) : null}
      </div>

      {detail.agent?.events.length ? (
        <div className="grid gap-2">
          <h3 className="m-0 text-[15px] text-cream">{t("logTitle")}</h3>
          <ol className="m-0 grid list-none gap-1 p-0 font-mono text-[12px] leading-relaxed text-muted">
            {detail.agent.events.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="mr-2 text-dim">{new Date(e.at).toISOString().slice(5, 16).replace("T", " ")}</span>
                <span className={e.kind === "error" ? "text-coral" : "text-cream"}>{e.text}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
