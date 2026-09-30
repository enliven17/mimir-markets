/**
 * One reading of a claim's V3 state for every page and API: which phase it is
 * in, what to call it, and which bucket (live / settling / settled) it
 * belongs to. Pure; mirrors lib/solana/config.ts numbering
 * (OPEN 0, ACTIVE 1, RESOLVED 2, CANCELLED 3, PROPOSED 4, DISPUTED 5).
 */
import {
  ST_ACTIVE,
  ST_CANCELLED,
  ST_DISPUTED,
  ST_OPEN,
  ST_PROPOSED,
  ST_RESOLVED,
} from "./solana/config";

export type ClaimPhase =
  | "open"
  | "active"
  /** ACTIVE past its deadline: waiting for the oracle to propose. */
  | "awaiting"
  | "proposed"
  | "disputed"
  | "resolved"
  | "cancelled";

export function claimPhase(state: number, deadline: number, now = Math.floor(Date.now() / 1000)): ClaimPhase {
  switch (state) {
    case ST_OPEN:
      return "open";
    case ST_ACTIVE:
      return deadline <= now ? "awaiting" : "active";
    case ST_PROPOSED:
      return "proposed";
    case ST_DISPUTED:
      return "disputed";
    case ST_RESOLVED:
      return "resolved";
    case ST_CANCELLED:
      return "cancelled";
    default:
      return "open";
  }
}

export const PHASE_LABEL: Record<ClaimPhase, string> = {
  open: "Open",
  active: "Live",
  awaiting: "Awaiting verdict",
  proposed: "Proposed",
  disputed: "Disputed",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

/** Still takes (or holds) positions before the deadline logic: OPEN / ACTIVE. */
export function isLiveState(state: number): boolean {
  return state === ST_OPEN || state === ST_ACTIVE;
}

/** A verdict is proposed but not final yet: PROPOSED / DISPUTED. */
export function isPendingVerdict(state: number): boolean {
  return state === ST_PROPOSED || state === ST_DISPUTED;
}

/** Off the live board: a verdict is in (final or not), or it was cancelled. */
export function isArchivedState(state: number): boolean {
  return state === ST_RESOLVED || state === ST_CANCELLED || isPendingVerdict(state);
}

/** Stakes are still escrowed and unsettled (counts toward the open pool). */
export function holdsStakes(state: number): boolean {
  return isLiveState(state) || isPendingVerdict(state);
}

/**
 * The side a claim leans to for display: the final winner once RESOLVED, the
 * proposed side while PROPOSED / DISPUTED, NONE otherwise.
 */
export function displayedSide(state: number, winnerSide: number, proposedSide: number | undefined): number {
  if (state === ST_RESOLVED) return winnerSide;
  if (isPendingVerdict(state)) return proposedSide ?? 0;
  return 0;
}

export const SIDE_LABEL: Record<number, string> = {
  0: "Pending",
  1: "Creator wins",
  2: "Challengers win",
  3: "Draw (refunded)",
  4: "Unresolvable (refunded)",
};

/** "2d 4h", "3h 12m", "4m 09s", "0s": a compact countdown to `until` (unix seconds). */
export function formatCountdown(until: number, now: number): string {
  const s = Math.max(0, Math.floor(until - now));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}
