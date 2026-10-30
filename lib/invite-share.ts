/**
 * Sharing a leaderboard invite (lib/campaign.ts) on X. X's post intent carries text and one link, never an image;
 * the image comes from the link: /i/<code> serves an X card (summary_large_image) rendered by /api/og/invite in the
 * brand. So a share is the caption + the /i/<code> link, and X shows the card under the post.
 */
import { INVITE_CODE_PATTERN } from "./campaign";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mimirmarkets.xyz").replace(/\/$/, "");
/** Bump when the card design changes, so X fetches the new image. */
export const INVITE_CARD_VERSION = 1;

/** The code, normalized, or null when it is not a leaderboard code: the card and page never render arbitrary text. */
export function inviteCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return INVITE_CODE_PATTERN.test(code) ? code : null;
}

export const inviteLink = (code: string, origin = SITE_URL) => `${origin}/i/${encodeURIComponent(code)}`;
export const inviteCardUrl = (code: string, origin = SITE_URL) => `${origin}/api/og/invite?code=${encodeURIComponent(code)}&v=${INVITE_CARD_VERSION}`;

/** Where the invite page sends people: the leaderboard with the referral. */
export const inviteTarget = (code: string) => `/campaign?ref=${code}`;

export const inviteCaption = (code: string) =>
  `I'm on the Mimir leaderboard. Stake on any claim and an AI oracle settles it in the open: markets on Arc, your wallet on Solana.\n\nJoin with my code ${code} for a points boost.`;

/** The X post composer, prefilled; the link brings the card. */
export const xIntentUrl = (code: string, origin = SITE_URL) =>
  `https://x.com/intent/post?text=${encodeURIComponent(inviteCaption(code))}&url=${encodeURIComponent(inviteLink(code, origin))}`;
