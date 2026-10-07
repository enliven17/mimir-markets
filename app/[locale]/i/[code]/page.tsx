import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SURFACE } from "@/components/arena/surface";
import { Link } from "@/i18n/navigation";
import { inviteCardUrl, inviteKind, inviteLink, inviteTarget } from "@/lib/invite-share";

/* /i/<code>: where a shared invite lands (lib/invite-share.ts). Its X card is the invite image; the page itself
 * explains the invite and sends people on with the code filled in. */

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const parsed = inviteKind(decodeURIComponent((await params).code));
  if (!parsed) return { title: "Invite · Mimir Markets", robots: { index: false } };
  const access = parsed.kind === "access";
  const title = access ? "You're invited to Mimir" : "Join me on Mimir";
  const description = access
    ? `An invite into Mimir: claims, settled by AI. Use code ${parsed.code} to get in; no $MIMIR needed.`
    : `Join the Mimir leaderboard with code ${parsed.code} for a points boost. Claims, settled by AI.`;
  const image = { url: inviteCardUrl(parsed.code), width: 1200, height: 630, alt: `${title}: invite code ${parsed.code}` };
  return {
    title: `${title} · Mimir Markets`,
    description,
    // One page per code: worth a share card, not a search result.
    robots: { index: false, follow: true },
    alternates: { canonical: inviteLink(parsed.code) },
    openGraph: { title, description, url: inviteLink(parsed.code), images: [image], type: "website", siteName: "Mimir Markets" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function InvitePage({ params }: { params: Params }) {
  const parsed = inviteKind(decodeURIComponent((await params).code));
  if (!parsed) notFound();
  const access = parsed.kind === "access";
  return (
    <div className="mx-auto grid max-w-[560px] gap-6 py-6">
      <header className="grid gap-3">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">{access ? "Invite" : "Leaderboard invite"}</p>
        <h1 className="m-0 font-display text-app-h1 text-cream">{access ? "You're invited to Mimir." : "Join me on Mimir."}</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted">
          Stake on any claim; an AI oracle settles it in the open. Markets settle on Arc, your wallet and $MIMIR stay on Solana.
        </p>
      </header>
      <section className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
        <p className="m-0 text-[14px] text-muted">{access ? "Your invite code" : "Invite code"}</p>
        <p className="m-0 rounded-xl bg-cream px-4 py-3 text-center font-mono text-[22px] tracking-[0.12em] text-ink">{parsed.code}</p>
        <p className="m-0 text-[13px] text-muted">
          {access
            ? "Connect your Solana wallet, sign in, and the code is filled in for you. You don't need $MIMIR with a code. Each code works once."
            : "Join the leaderboard with this code and your points get a boost. Joining is one free signature."}
        </p>
        <Link href={inviteTarget(parsed.kind, parsed.code)} className="justify-self-start rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] hover:brightness-110">
          {access ? "Use my invite" : "Join the leaderboard"}
        </Link>
      </section>
    </div>
  );
}
