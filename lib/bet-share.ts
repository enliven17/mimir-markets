/**
 * Sharing a bet on X: X's composer takes text and one link, and the link /b/<ref>?side=N carries the X card
 * (/api/og/bet) showing the market and the side taken. <ref> is "<kind>-<id>" for Arc (as before Base) and
 * "base-<kind>-<id>" for Base (lib/chains/links.ts).
 * Nothing personal goes into the link or the card; the amount is only in the caption the user can edit.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mimirmarkets.xyz").replace(/\/$/, "");

export type BetKind = "vs" | "pool";
export type BetChain = "arc" | "base";
/** Bump when the card design changes, so X fetches the new image. */
export const BET_CARD_VERSION = 1;

export const betRef = (kind: BetKind, id: number, chain: BetChain = "arc") => `${chain === "arc" ? "" : `${chain}-`}${kind}-${id}`;

export function parseBetRef(ref: string, side: string | null): { chain: BetChain; kind: BetKind; id: number; side: 1 | 2 } | null {
  const m = /^(?:(arc|base)-)?(vs|pool)-(\d{1,9})$/.exec(ref);
  const s = Number(side);
  if (!m || (s !== 1 && s !== 2)) return null;
  return { chain: (m[1] as BetChain | undefined) ?? "arc", kind: m[2] as BetKind, id: Number(m[3]), side: s as 1 | 2 };
}

export const betLink = (kind: BetKind, id: number, side: 1 | 2, origin = SITE_URL, chain: BetChain = "arc") => `${origin}/b/${betRef(kind, id, chain)}?side=${side}`;
export const betCardUrl = (kind: BetKind, id: number, side: 1 | 2, origin = SITE_URL, chain: BetChain = "arc") =>
  `${origin}/api/og/bet?kind=${kind}&id=${id}&side=${side}${chain === "arc" ? "" : `&chain=${chain}`}&v=${BET_CARD_VERSION}`;

export function betCaption(question: string, sideLabel: string, amountUsd: string, isPrivate = false): string {
  const q = question.length > 140 ? `${question.slice(0, 137)}…` : question;
  if (isPrivate) return `I put ${amountUsd} on "${sideLabel}".\n\n${q}\n\nOnly creator-approved wallets can join this private claim.`;
  return `I put ${amountUsd} on "${sideLabel}".\n\n${q}\n\nThink I'm wrong? Take the other side on Mimir. An AI oracle settles it in the open.`;
}

export const betIntentUrl = (kind: BetKind, id: number, side: 1 | 2, question: string, sideLabel: string, amountUsd: string, origin = SITE_URL, chain: BetChain = "arc", isPrivate = false) =>
  `https://x.com/intent/post?text=${encodeURIComponent(betCaption(question, sideLabel, amountUsd, isPrivate))}&url=${encodeURIComponent(betLink(kind, id, side, origin, chain))}`;
