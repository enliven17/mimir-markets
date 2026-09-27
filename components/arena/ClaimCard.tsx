"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import { formatUsdcUnitsBare as usdc } from "@/lib/money";

export interface SolanaClaim {
  id: number;
  creator: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  /** 6-dp base units */
  creatorStake: string;
  /** 6-dp base units */
  totalChallengerStake: string;
  deadline: number;
  state: number;
  winnerSide: number;
  resolutionSummary: string;
  confidence: number;
  createdAt: number;
  maxChallengers: number;
  delegated: boolean;
  challengers: { addr: string; stake: string; paid: boolean }[];
}

interface ClaimCardProps {
  claim: SolanaClaim;
  locale: string;
}

const ARENA_STAT_CELL =
  "rounded border border-black/[0.1] bg-black/[0.03] px-3 py-2.5 sm:px-3.5 sm:py-3";

function formatArenaIdCode(id: number): string {
  const n = Math.abs(id) % 100000;
  const padded = String(n).padStart(4, "0");
  const letter = String.fromCharCode(65 + (Math.abs(id) % 26));
  return `#${padded}-${letter}`;
}

type StatusVariant = "live" | "muted" | "archived";

function getStatusPresentation(state: number): {
  label: string;
  variant: StatusVariant;
} {
  // 0 OPEN, 1 ACTIVE, 2 RESOLVED, 3 CANCELLED
  if (state >= 2) return { label: "ARCHIVED", variant: "archived" };
  if (state === 1) return { label: "LIVE", variant: "live" };
  return { label: "PENDING", variant: "muted" };
}

export default function ClaimCard({ claim, locale }: ClaimCardProps) {
  const activeChallengers = claim.challengers.length;
  const maxChallengers =
    typeof claim.maxChallengers === "number" && claim.maxChallengers > 0
      ? claim.maxChallengers
      : 1;
  const isArchived = claim.state >= 2;
  const { label: statusLabel, variant: statusVariant } = getStatusPresentation(
    claim.state
  );

  const poolUnits = (
    Number(claim.creatorStake) + Number(claim.totalChallengerStake)
  ).toString();

  const isFlashTrade = (claim.resolutionUrl ?? "").includes("flashapi.trade");

  const statusPillClass =
    statusVariant === "live"
      ? "font-display text-xs font-semibold uppercase tracking-wide text-pv-emerald bg-pv-emerald/10 px-2 py-1"
      : "font-display text-xs font-semibold uppercase tracking-wide text-pv-muted bg-black/[0.06] px-2 py-1 ring-1 ring-black/[0.08]";

  return (
    <article className="card group relative flex h-full flex-col gap-6 overflow-hidden border-black/[0.12] bg-pv-surface p-6 transition-all duration-300 hover:border-pv-emerald/30 hover:bg-pv-surface2 sm:gap-8 sm:p-8">
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={statusPillClass}>{statusLabel}</span>
          {claim.delegated ? (
            <span className="inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-emerald bg-pv-emerald/10">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pv-emerald" />
              ⚡ Live on ER
            </span>
          ) : null}
          {isFlashTrade ? (
            <span className="inline-flex items-center rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-gold bg-pv-gold/10 ring-1 ring-pv-gold/20">
              Flash Trade
            </span>
          ) : null}
        </div>
        <span className="rounded px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-pv-muted ring-1 ring-black/[0.1] bg-black/[0.03] backdrop-blur-sm">
          {formatArenaIdCode(claim.id)}
        </span>
      </div>

      <div className="relative z-10 min-w-0 flex-1">
        <h3 className="line-clamp-2 font-display text-xl font-bold uppercase leading-tight tracking-tight text-pv-text sm:text-2xl">
          {claim.question}
        </h3>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-left text-[11px] font-display font-bold uppercase tracking-[0.12em] text-pv-muted sm:text-xs">
              {claim.category}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
            <div className={ARENA_STAT_CELL}>
              <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-pv-muted">
                Min Stake
              </span>
              <span className="mt-1 block font-display text-sm font-bold uppercase tabular-nums tracking-tight text-pv-text sm:text-[15px]">
                {usdc(claim.creatorStake)} USDC
              </span>
            </div>
            <div className={ARENA_STAT_CELL}>
              <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-pv-muted">
                Category
              </span>
              <span className="mt-1 block truncate font-display text-sm font-bold uppercase leading-snug tracking-tight text-pv-text sm:text-[15px]">
                {claim.category}
              </span>
            </div>
            <div className={ARENA_STAT_CELL}>
              <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-pv-muted">
                Pool
              </span>
              <span className="mt-1 block font-display text-sm font-bold uppercase tabular-nums tracking-tight text-pv-text sm:text-[15px]">
                {usdc(poolUnits)} USDC
              </span>
            </div>
            <div className={ARENA_STAT_CELL}>
              <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-pv-muted">
                Fill Status
              </span>
              <span className="mt-1 block font-display text-sm font-bold uppercase tabular-nums tracking-tight text-pv-emerald sm:text-[15px]">
                {activeChallengers}/{maxChallengers}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-auto border-t border-black/[0.1] pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-muted">
              Challengers
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center pl-0.5">
                {["bg-pv-surface2", "bg-pv-surface", "bg-pv-emerald/30"].map(
                  (color, i) => (
                    <span
                      key={`${claim.id}-avatar-${i}`}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.15] ${color} ${
                        i > 0 ? "-ml-2.5" : ""
                      }`}
                      style={{ zIndex: 10 - i }}
                    >
                      <UserRound size={14} className="text-pv-text/90" aria-hidden />
                    </span>
                  )
                )}
              </div>
              <span className="font-display text-2xl font-bold tabular-nums tracking-tight text-pv-text sm:text-3xl">
                {activeChallengers}
              </span>
            </div>
          </div>

          <Link
            href={`/${locale}/arena/${claim.id}`}
            className={
              isArchived
                ? "inline-flex shrink-0 items-center justify-center rounded-md border border-black/[0.15] bg-transparent px-5 py-2 font-display text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted shadow-none transition-[color,border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-px hover:border-black/[0.28] hover:bg-transparent hover:text-pv-text hover:shadow-[0_4px_18px_-6px_rgba(0,0,0,0.45)] active:translate-y-0 active:scale-[0.98] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-surface"
                : "inline-flex shrink-0 items-center justify-center rounded-md bg-pv-text px-5 py-2 font-display text-[10px] font-bold uppercase tracking-[0.18em] text-pv-bg shadow-none transition-[transform,box-shadow,background-color,border-color,color] duration-200 ease-out hover:-translate-y-px hover:bg-pv-emerald hover:text-pv-bg hover:shadow-[0_6px_18px_-4px_rgba(153,69,255,0.35)] active:translate-y-0 active:scale-[0.98] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/40 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-surface"
            }
          >
            {isArchived ? "View Details" : "Join"}
          </Link>
        </div>
      </div>
    </article>
  );
}
