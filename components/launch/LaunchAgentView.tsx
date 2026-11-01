"use client";

/**
 * One agent's page: its face, its wallets, its optional token (chart, launch and fee claims for the owner), the owner's
 * controls, copying its stakes, and its record and reasoning log (/api/launch/:id/detail).
 */
import { useEffect, useState } from "react";
import { marketPath } from "@/lib/chains/links";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { api } from "@/convex/_generated/api";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { Strip, StripCell } from "@/components/ui/Strip";
import { Link } from "@/i18n/navigation";
import type { CouncilAgent } from "@/lib/launch/council-view";
import AgentFace from "./AgentFace";
import CopyPanel from "./CopyPanel";
import OwnerControls from "./OwnerControls";
import TokenBlock from "./TokenBlock";
import WalletsBlock from "./WalletsBlock";
import FollowButton from "@/components/discovery/FollowButton";
import PublicMarketRecord from "./PublicMarketRecord";

type Council = CouncilAgent & { displayName: string; bio: string };
type Bet = { chain?: "arc" | "base"; kind: "vs" | "pool"; marketId: number; label: string; question: string; usdc: number; outcome: "open" | "won" | "lost" | "refunded"; pnl: number };
type Detail = {
  agent: null | { events: { at: number; kind: string; text: string; chain: string | null; tx: string | null }[] };
  arc: Bet[];
};

const usd = (n: number) => `${n < 0 ? "-" : n > 0 ? "+" : ""}${Math.abs(n).toFixed(2)}`;

export default function LaunchAgentView({ slug, council }: { slug: string; council: Council | null }) {
  const t = useTranslations("launch");
  const card = useQuery(api.launch.card, council ? "skip" : { slug });
  if (!council && card === undefined) return <Skeleton className="h-72 w-full rounded-2xl" />;
  if (!council && !card) return <EmptyState>{t("notFound")}</EmptyState>;

  const a = council
    ? { name: council.displayName, ticker: council.ticker, seed: slug, about: council.bio, token: council.token, arc: council.arc, base: council.base?.address ?? null, house: true }
    : { name: card!.name, ticker: card!.ticker, seed: card!.avatarSeed, about: card!.thesis, token: card!.token, arc: card!.arc, base: card!.base, house: false };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <Link href="/launch" className="text-[14px] text-muted hover:text-cream">
        ← {t("title")}
      </Link>
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 sm:gap-x-5">
        <AgentFace seed={a.seed} size={96} className="rounded-2xl shadow-[inset_0_0_0_1px_rgb(243_234_214/.08)] max-sm:!h-[72px] max-sm:!w-[72px] sm:row-span-2" />
        <div className="grid min-w-0 gap-1.5 sm:self-end">
          <h1 className="m-0 font-display text-app-h1 leading-none text-cream">{a.name}</h1>
          <p className="m-0 text-[14px] text-muted">
            <span className="mr-2 font-mono text-coral">${a.ticker}</span>
            {a.house ? t("councilBadge") : null}
          </p>
        </div>
        {a.about ? <p className="col-span-2 m-0 max-w-[62ch] text-[15px] leading-relaxed text-muted sm:col-span-1 sm:col-start-2 sm:row-start-2 sm:self-start">{a.about}</p> : null}
      </header>

      <FollowButton target={`agent:${slug}`} label="Follow agent forecasts" />
      <PublicMarketRecord address={a.arc} />
      <WalletsBlock ticker={a.ticker} token={a.token} arc={a.arc} base={a.base} />
      <TokenBlock slug={slug} ticker={a.ticker} owner={card?.owner ?? null} status={card?.status ?? "live"} token={a.token} />
      {!a.house && card ? <OwnerControls slug={slug} owner={card.owner} status={card.status} arc={card.arc} base={card.base} /> : null}
      <CopyPanel slug={slug} ticker={a.ticker} />
      <RecordSection slug={slug} />
    </div>
  );
}

function RecordSection({ slug }: { slug: string }) {
  const t = useTranslations("launch");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/launch/${slug}/detail`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) setDetail(body as Detail);
        else setError((body as { error?: string }).error ?? t("recordUnavailable"));
      })
      .catch(() => live && setError(t("recordUnavailable")));
    return () => {
      live = false;
    };
  }, [slug, t]);

  if (!detail) {
    return (
      <section className="grid justify-items-start gap-3 rounded-2xl bg-cream/[0.04] p-5">
        <h2 className="m-0 font-display text-[1.4rem] text-cream">{t("recordTitle")}</h2>
        {error ? <p className="m-0 max-w-[60ch] text-[14px] text-muted">{error}</p> : <Skeleton className="h-16 w-full" />}
      </section>
    );
  }

  const bets = detail.arc;
  const won = bets.filter((b) => b.outcome === "won").length;
  const lost = bets.filter((b) => b.outcome === "lost").length;
  return (
    <section className="grid gap-5">
      <h2 className="m-0 font-display text-[1.4rem] text-cream">{t("recordTitle")}</h2>
      <Strip label={t("recordTitle")} className="overflow-hidden rounded-2xl">
        <StripCell label={t("arcStakes")} value={bets.length} />
        <StripCell label={t("winRate")} value={won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : "-"} />
        <StripCell label={t("arcPnl")} value={`${usd(bets.reduce((x, b) => x + b.pnl, 0))} USDC`} />
        <StripCell label={t("atRisk")} value={`${bets.filter((b) => b.outcome === "open").reduce((x, b) => x + b.usdc, 0).toFixed(2)} USDC`} />
      </Strip>

      <div className="grid gap-5">
        <div className="grid content-start gap-2">
          <h3 className="m-0 text-[15px] text-cream">{t("stakesTitle")}</h3>
          {bets.length ? (
            <ul className="m-0 grid list-none gap-1.5 p-0 text-[13px]">
              {bets.slice(0, 15).map((b) => (
                <li key={`${b.chain ?? "arc"}-${b.kind}-${b.marketId}-${b.label}`} className="flex items-baseline justify-between gap-3">
                  <Link href={marketPath(b.chain, b.kind, b.marketId)} className="min-w-0 truncate text-muted hover:text-coral">
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
