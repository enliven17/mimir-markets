import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SURFACE } from "@/components/arena/surface";
import { Link, redirect } from "@/i18n/navigation";
import { inviteCardUrl, inviteCode, inviteLink, inviteTarget } from "@/lib/invite-share";

/* /i/<code>: where a shared leaderboard invite lands (lib/invite-share.ts). Its X card is the invite image; the page
 * itself explains the invite and sends people on with the code filled in. */

type Params = Promise<{ locale: string; code: string }>;

// Links to the old access codes (MIMIR-XXXX-XXXX) are still out there; Mimir is open now, so they go to the arena.
const LEGACY_ACCESS_CODE = /^MIMIR-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const code = inviteCode(decodeURIComponent((await params).code));
  if (!code) return { title: "Invite · Mimir Markets", robots: { index: false } };
  const title = "Join me on Mimir";
  const description = `Join the Mimir leaderboard with code ${code} for a points boost. Claims, settled by AI.`;
  const image = { url: inviteCardUrl(code), width: 1200, height: 630, alt: `${title}: invite code ${code}` };
  return {
    title: `${title} · Mimir Markets`,
    description,
    // One page per code: worth a share card, not a search result.
    robots: { index: false, follow: true },
    alternates: { canonical: inviteLink(code) },
    openGraph: { title, description, url: inviteLink(code), images: [image], type: "website", siteName: "Mimir Markets" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function InvitePage({ params }: { params: Params }) {
  const { locale, code: raw } = await params;
  const decoded = decodeURIComponent(raw).trim();
  if (LEGACY_ACCESS_CODE.test(decoded)) redirect({ href: "/arena", locale });
  const code = inviteCode(decoded);
  if (!code) notFound();
  return (
    <div className="mx-auto grid max-w-[560px] gap-6 py-6">
      <header className="grid gap-3">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">Leaderboard invite</p>
        <h1 className="m-0 font-display text-app-h1 text-cream">Join me on Mimir.</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted">
          Stake on any claim; an AI oracle settles it in the open. Markets settle on Arc, your wallet stays on Solana.
        </p>
      </header>
      <section className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
        <p className="m-0 text-[14px] text-muted">Invite code</p>
        <p className="m-0 rounded-xl bg-cream px-4 py-3 text-center font-mono text-[22px] tracking-[0.12em] text-ink">{code}</p>
        <p className="m-0 text-[13px] text-muted">Join the leaderboard with this code and your points get a boost. Joining is one free signature.</p>
        <Link href={inviteTarget(code)} className="justify-self-start rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] hover:brightness-110">
          Join the leaderboard
        </Link>
      </section>
    </div>
  );
}
