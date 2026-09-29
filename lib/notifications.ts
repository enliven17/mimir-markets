/**
 * Notification events derived from read-index changes. Pure: the indexer
 * worker calls claimEvents(before, after) for every claim it re-reads, and
 * lib/server/notifications.ts stores and delivers what comes back.
 *
 * Recipients are base58 wallet addresses, never lowercased (base58 is
 * case-sensitive). Every event is derived from public on-chain state.
 */
import {
  SIDE_CHALLENGERS,
  SIDE_CREATOR,
  ST_CANCELLED,
  ST_DISPUTED,
  ST_PROPOSED,
  ST_RESOLVED,
} from "./solana/config";
import { challengerGross, creatorGross } from "./solana/fees";

export const NOTIFICATION_KINDS = [
  "challenged",
  "proposed",
  "disputed",
  "resolved",
  "cancelled",
  "payout_claimable",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationEvent {
  recipient: string;
  claimId: number;
  kind: NotificationKind;
  /** Distinguishes repeats of a kind on one claim (the 2nd vs 3rd challenge). */
  dedupe: string;
  payload: Record<string, unknown>;
}

/** The read-index fields the diff needs (a subset of SolanaClaimRow). */
export interface ClaimSnapshot {
  id: number;
  creator: string;
  question: string;
  state: number;
  winner_side: number;
  proposed_side?: number;
  disputable_until?: number;
  disputer?: string;
  resolution_summary?: string;
  confidence?: number;
  creator_stake: string;
  total_challenger_stake: string;
  creator_paid?: boolean;
  challengers: Array<{ addr: string; stake: string; paid?: boolean }>;
}

export type PriorSnapshot = Pick<ClaimSnapshot, "state" | "challengers">;

/** Did `recipient` end up on the winning side? null for a draw / refund. */
function wonSide(side: number, recipient: string, creator: string): boolean | null {
  if (side === SIDE_CREATOR) return recipient === creator;
  if (side === SIDE_CHALLENGERS) return recipient !== creator;
  return null;
}

function participants(c: ClaimSnapshot): string[] {
  return [...new Set([c.creator, ...c.challengers.map((ch) => ch.addr)])];
}

/** Unpaid payout legs of a RESOLVED claim, keyed by who can pull them. */
function claimableLegs(c: ClaimSnapshot): Array<{ recipient: string; gross: bigint; leg: string }> {
  const creatorStake = BigInt(c.creator_stake || "0");
  const total = BigInt(c.total_challenger_stake || "0");
  const legs: Array<{ recipient: string; gross: bigint; leg: string }> = [];
  const cg = creatorGross(c.winner_side, creatorStake, total);
  if (cg && !c.creator_paid) legs.push({ recipient: c.creator, gross: cg.gross, leg: "creator" });
  c.challengers.forEach((ch, i) => {
    const g = challengerGross(c.winner_side, BigInt(ch.stake || "0"), creatorStake, total);
    if (g && !ch.paid) legs.push({ recipient: ch.addr, gross: g.gross, leg: `challenger:${i}` });
  });
  return legs;
}

/**
 * Events a change from `before` to `after` should produce. Nothing for a claim
 * seen for the first time: its creator already knows it exists, and a fresh
 * index must not replay the whole history.
 */
export function claimEvents(before: PriorSnapshot | null, after: ClaimSnapshot): NotificationEvent[] {
  if (!before) return [];
  const claimId = after.id;
  const question = after.question.slice(0, 140);
  const events: NotificationEvent[] = [];
  const toAll = (kind: NotificationKind, dedupe: string, payload: (r: string) => Record<string, unknown>) => {
    for (const recipient of participants(after)) {
      events.push({ recipient, claimId, kind, dedupe, payload: { question, ...payload(recipient) } });
    }
  };

  const count = after.challengers.length;
  if (count > before.challengers.length) {
    const latest = after.challengers[count - 1];
    events.push({
      recipient: after.creator,
      claimId,
      kind: "challenged",
      dedupe: `count:${count}`,
      payload: { question, challenger: latest?.addr ?? null, stake: latest?.stake ?? null, challengers: count },
    });
  }

  const entered = (state: number) => before.state !== state && after.state === state;

  if (entered(ST_PROPOSED)) {
    const side = after.proposed_side ?? 0;
    toAll("proposed", "proposed", (r) => ({
      proposedSide: side,
      disputableUntil: after.disputable_until ?? 0,
      youWinIfFinal: wonSide(side, r, after.creator),
    }));
  }

  if (entered(ST_DISPUTED)) {
    toAll("disputed", "disputed", () => ({ disputer: after.disputer || null }));
  }

  if (entered(ST_RESOLVED)) {
    toAll("resolved", "resolved", (r) => ({
      winnerSide: after.winner_side,
      confidence: after.confidence ?? 0,
      summary: (after.resolution_summary ?? "").slice(0, 280),
      youWon: wonSide(after.winner_side, r, after.creator),
    }));
    // One "you can pull this now" per unpaid leg. The oracle cranks payouts
    // too, so a leg paid in the same cycle never produces one.
    for (const leg of claimableLegs(after)) {
      events.push({
        recipient: leg.recipient,
        claimId,
        kind: "payout_claimable",
        dedupe: leg.leg,
        payload: { question, grossUnits: leg.gross.toString(), leg: leg.leg },
      });
    }
  }

  if (entered(ST_CANCELLED)) {
    toAll("cancelled", "cancelled", () => ({}));
  }
  return events;
}

/** What a wallet signs (ed25519, UTF-8) to point its notifications at a webhook (url "" removes it). */
export function webhookMessage(address: string, url: string, signedAt: number): string {
  return ["Mimir notifications webhook", `address: ${address}`, `url: ${url || "(remove)"}`, `signedAt: ${signedAt}`].join("\n");
}

/** Retry schedule for a webhook delivery (ms before attempt 2, 3, …). Bounded. */
export const WEBHOOK_RETRY_DELAYS_MS = [1_000, 5_000] as const;

/** Only a network failure, a 429 or a 5xx is worth another attempt. */
export function isRetryableStatus(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}
