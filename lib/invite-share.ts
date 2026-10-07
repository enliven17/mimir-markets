/**
 * Sharing an invite on X. X's post intent carries text and one link, never an image; the image comes from the
 * link: /i/<code> serves an X card (summary_large_image) rendered by /api/og/invite in the brand. So a share is
 * the caption + the /i/<code> link, and X shows the card under the post.
 *
 * Two kinds of code:
 *   - access:   MIMIR-XXXX-XXXX, a member's invite into invite-only Mimir (lib/access.ts)
 *   - campaign: 8 letters/digits, a leaderboard referral (lib/campaign.ts)
 */
import { INVITE_PATTERN } from "./access";
import { INVITE_CODE_PATTERN } from "./campaign";

export type InviteKind = "access" | "campaign";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mimirmarkets.xyz").replace(/\/$/, "");
/** Bump when the card design changes, so X fetches the new image. */
export const INVITE_CARD_VERSION = 1;

/** The kind of a code, or null when it is neither: the card and page never render arbitrary text. */
export function inviteKind(raw: string): { kind: InviteKind; code: string } | null {
  const code = raw.trim().toUpperCase();
  if (INVITE_PATTERN.test(code)) return { kind: "access", code };
  if (INVITE_CODE_PATTERN.test(code)) return { kind: "campaign", code };
  return null;
}

export const inviteLink = (code: string, origin = SITE_URL) => `${origin}/i/${encodeURIComponent(code)}`;
export const inviteCardUrl = (code: string, origin = SITE_URL) => `${origin}/api/og/invite?code=${encodeURIComponent(code)}&v=${INVITE_CARD_VERSION}`;

/** Where the invite page sends people: the gate with the code filled in, or the leaderboard with the referral. */
export const inviteTarget = (kind: InviteKind, code: string) => (kind === "access" ? `/arena?invite=${code}` : `/campaign?ref=${code}`);

export function inviteCaption(kind: InviteKind, code: string): string {
  return kind === "access"
    ? `Mimir is invite-only, and this one is for you: ${code}\n\nStake on any claim; an AI oracle settles it in the open. Markets settle on Arc, your wallet stays on Solana. No $MIMIR needed with a code.`
    : `I'm on the Mimir leaderboard. Stake on any claim and an AI oracle settles it in the open: markets on Arc, your wallet on Solana.\n\nJoin with my code ${code} for a points boost.`;
}

/** The X post composer, prefilled; the link brings the card. */
export const xIntentUrl = (kind: InviteKind, code: string, origin = SITE_URL) =>
  `https://x.com/intent/post?text=${encodeURIComponent(inviteCaption(kind, code))}&url=${encodeURIComponent(inviteLink(code, origin))}`;
