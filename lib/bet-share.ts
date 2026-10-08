/**
 * Sharing a bet on X, the same way as an invite (lib/invite-share.ts): X's composer takes text and one link, and
 * the link /b/<kind>-<id>?side=N carries the X card (/api/og/bet) showing the market and the side taken.
 * Nothing personal goes into the link or the card; the amount is only in the caption the user can edit.
 */
import { SITE_URL } from "./invite-share";

export type BetKind = "vs" | "pool";
/** Bump when the card design changes, so X fetches the new image. */
export const BET_CARD_VERSION = 1;

export const betRef = (kind: BetKind, id: number) => `${kind}-${id}`;

export function parseBetRef(ref: string, side: string | null): { kind: BetKind; id: number; side: 1 | 2 } | null {
  const m = /^(vs|pool)-(\d{1,9})$/.exec(ref);
  const s = Number(side);
  if (!m || (s !== 1 && s !== 2)) return null;
  return { kind: m[1] as BetKind, id: Number(m[2]), side: s as 1 | 2 };
}

export const betLink = (kind: BetKind, id: number, side: 1 | 2, origin = SITE_URL) => `${origin}/b/${betRef(kind, id)}?side=${side}`;
export const betCardUrl = (kind: BetKind, id: number, side: 1 | 2, origin = SITE_URL) =>
  `${origin}/api/og/bet?kind=${kind}&id=${id}&side=${side}&v=${BET_CARD_VERSION}`;

export function betCaption(question: string, sideLabel: string, amountUsd: string): string {
  const q = question.length > 140 ? `${question.slice(0, 137)}…` : question;
  return `I put ${amountUsd} on "${sideLabel}".\n\n${q}\n\nThink I'm wrong? Take the other side on Mimir. An AI oracle settles it in the open.`;
}

export const betIntentUrl = (kind: BetKind, id: number, side: 1 | 2, question: string, sideLabel: string, amountUsd: string, origin = SITE_URL) =>
  `https://x.com/intent/post?text=${encodeURIComponent(betCaption(question, sideLabel, amountUsd))}&url=${encodeURIComponent(betLink(kind, id, side, origin))}`;
