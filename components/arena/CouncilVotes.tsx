"use client";

/**
 * CouncilVotes — shows where each AI council persona stands on a claim.
 * For resolved claims also shows won/lost/refunded outcome per persona.
 */
import { useEffect, useState } from "react";
import PeepAvatar from "@/components/ui/PeepAvatar";

interface PersonaVote {
  slug: string;
  displayName: string;
  emoji: string;
  archetype: string;
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
function outcomeTag(v: PersonaVote, winnerSide: number): { label: string; cls: string } | null {
  if (!v.staked) return null;
  if (winnerSide === 2) return { label: v.paid ? "WON · PAID" : "WON", cls: "text-pv-emerald border-pv-emerald/40 bg-pv-emerald/[0.08]" };
  if (winnerSide === 1) return { label: "LOST", cls: "text-pv-danger border-pv-danger/40 bg-pv-danger/[0.06]" };
  if (winnerSide === 3 || winnerSide === 4) return { label: v.paid ? "REFUNDED" : "REFUNDING", cls: "text-pv-gold border-pv-gold/40 bg-pv-gold/[0.08]" };
  return null;
}

function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

interface Props {
  claimId: number;
  /** claim.state: 0 open, 1 active, 2 resolved, 3 cancelled, 4 proposed, 5 disputed (outcomes show once RESOLVED) */
  claimState?: number;
  /** claim.winnerSide: 0=none,1=creator,2=challengers,3=draw,4=unresolvable */
  winnerSide?: number;
}

export default function CouncilVotes({ claimId, claimState, winnerSide = 0 }: Props) {
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
    return (
      <section className="border border-pv-border/25 bg-pv-surface p-5">
        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-pv-muted">Council verdict</div>
        <div className="mt-2 text-sm text-pv-muted">Reading on-chain stakes…</div>
      </section>
    );
  }

  if (error || !data) return null;
  if (data.total === 0) return null;

  const isResolved = claimState === 2;

  return (
    <section className="border border-pv-border/25 bg-pv-surface p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-pv-emerald">
            Council verdict
          </div>
          <p className="mt-0.5 text-[12px] text-pv-muted">
            {isResolved
              ? `Where each of the ${data.total} AI personas bet — and what it cost them.`
              : `Where each of the ${data.total} AI personas stands. ✓ means they staked the challenger side.`}
          </p>
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-pv-muted">
          {data.stakedCount} of {data.total} staked · {data.totalUsdc.toFixed(2)} USDC
        </div>
      </div>

      <ul className="bp-cells grid-cols-1 border border-pv-border/25 sm:grid-cols-2">
        {data.votes.map((v) => {
          const outcome = isResolved ? outcomeTag(v, winnerSide) : null;
          return (
            <li
              key={v.slug}
              className={`flex items-center justify-between gap-2 px-3 py-2 ${
                v.staked ? "bg-pv-emerald/[0.06]" : "bg-pv-surface"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <PeepAvatar seed={`council-${v.slug}`} size={28} tone={v.staked ? "accent" : "neutral"} />
                <span className={`truncate text-[12px] font-semibold ${v.staked ? "text-pv-text" : "text-pv-muted"}`}>
                  {v.displayName}
                </span>
              </div>
              {v.staked ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  {outcome ? (
                    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${outcome.cls}`}>
                      {outcome.label}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] tabular-nums text-pv-emerald">
                      ✓ {v.stakeUsdc.toFixed(2)} USDC
                    </span>
                  )}
                  {!outcome && (
                    <a
                      href={explorerAddr(v.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] text-pv-muted hover:text-pv-emerald"
                    >
                      ↗
                    </a>
                  )}
                  {outcome && (
                    <span className="font-mono text-[10px] tabular-nums text-pv-muted">
                      {v.stakeUsdc.toFixed(2)} USDC
                    </span>
                  )}
                </div>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">— abstain</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
