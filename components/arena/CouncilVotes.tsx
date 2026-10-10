"use client";

/**
 * CouncilVotes: shows where each AI council persona stands on a claim.
 * For resolved claims also shows won/lost/refunded outcome per persona.
 * A summary line up front, every vote behind "See all votes".
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import PeepAvatar from "@/components/ui/PeepAvatar";
import Disclosure from "@/components/ui/Disclosure";
import { explorerUrl } from "@/lib/solana/config";
import { ExternalMark } from "@/components/ExternalMark";

interface PersonaVote {
  slug: string;
  displayName: string;
  emoji: string;
  archetype: string;
  track?: "classic" | "philosopher";
  address: string;
  staked: boolean;
  stakeUsdc: number;
  paid: boolean;
}

interface CouncilResponse {
  claimId: number;
  total: number;
  stakedCount: number;
  totalUsdc: number;
  votes: PersonaVote[];
}

// winnerSide: 1=creator, 2=challengers, 3=draw/refund, 4=unresolvable/refund
type OutcomeKey = "won" | "wonPaid" | "lost" | "refunded" | "refunding";

function outcomeTag(v: PersonaVote, winnerSide: number): { key: OutcomeKey; cls: string } | null {
  if (!v.staked) return null;
  if (winnerSide === 2) return { key: v.paid ? "wonPaid" : "won", cls: "text-win" };
  if (winnerSide === 1) return { key: "lost", cls: "text-danger" };
  if (winnerSide === 3 || winnerSide === 4) return { key: v.paid ? "refunded" : "refunding", cls: "text-muted" };
  return null;
}

function explorerAddr(addr: string): string {
  return explorerUrl("address", addr);
}

interface Props {
  claimId: number;
  /** claim.state: 0 open, 1 active, 2 resolved, 3 cancelled, 4 proposed, 5 disputed (outcomes show once RESOLVED) */
  claimState?: number;
  /** claim.winnerSide: 0=none,1=creator,2=challengers,3=draw,4=unresolvable */
  winnerSide?: number;
}

export default function CouncilVotes({ claimId, claimState, winnerSide = 0 }: Props) {
  const t = useTranslations("arena.council");
  const [data, setData] = useState<CouncilResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/arena/${claimId}/council`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<CouncilResponse>;
      })
      .then((body) => { if (!cancelled) setData(body); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [claimId]);

  if (loading) {
    return <p className="m-0 text-[13px] text-muted">{t("reading")}</p>;
  }

  if (error || !data) return <p className="m-0 text-[13px] text-muted">{t("unavailable")}</p>;
  if (data.total === 0) return <p className="m-0 text-[13px] text-muted">{t("empty")}</p>;

  const isResolved = claimState === 2;

  return (
    <section className="grid gap-4" aria-label={t("label")}>
      <div className="grid gap-1.5">
        <p className="m-0 font-display text-[1.6rem] leading-none text-cream">
          {t("staked", { staked: data.stakedCount, total: data.total })}
          <span className="ml-2 font-mono text-[14px] text-muted">{data.totalUsdc.toFixed(2)} USDC</span>
        </p>
        <p className="m-0 text-[13px] text-muted">
          {isResolved ? t("hintResolved") : t("hintLive")}
        </p>
      </div>
      <Disclosure summary={t("seeAll")} meta={data.total}>
        <div className="grid gap-4">
          {(["classic", "philosopher"] as const).map((track) => {
            const votes = data.votes.filter((v) => (v.track ?? "classic") === track);
            if (votes.length === 0) return null;
            return (
              <div key={track} className="grid gap-1.5">
                <p className="m-0 text-[12px] text-dim">{t(track)}</p>
                <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
                  {votes.map((v) => {
                    const outcome = isResolved ? outcomeTag(v, winnerSide) : null;
                    return (
                      <li
                        key={v.slug}
                        className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${v.staked ? "bg-coral/[0.07]" : "bg-cream/[0.03]"}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <PeepAvatar seed={`council-${v.slug}`} size={26} tone={v.staked ? "accent" : "neutral"} />
                          <span className={`truncate text-[13px] ${v.staked ? "text-cream" : "text-muted"}`}>{v.displayName}</span>
                        </span>
                        {v.staked ? (
                          <span className="flex shrink-0 items-center gap-2 font-mono text-[12px] tabular-nums">
                            {outcome ? <span className={outcome.cls}>{t(outcome.key)}</span> : null}
                            <span className={outcome ? "text-muted" : "text-cream"}>{v.stakeUsdc.toFixed(2)}</span>
                            {!outcome ? (
                              <a href={explorerAddr(v.address)} target="_blank" rel="noreferrer" aria-label={t("explorer", { name: v.displayName })} className="text-muted hover:text-coral">
                                <ExternalMark />
                              </a>
                            ) : null}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[12px] text-dim">{t("abstain")}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Disclosure>
    </section>
  );
}
