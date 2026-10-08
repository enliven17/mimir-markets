import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SURFACE } from "@/components/arena/surface";
import { Link } from "@/i18n/navigation";
import { betCardUrl, betLink, parseBetRef } from "@/lib/bet-share";
import { arcMarketDetail } from "@/lib/server/arc-index";

/* /b/<kind>-<id>?side=N: where a shared bet lands (lib/bet-share.ts). Its X card is the bet image; the page shows
 * the market and sends people to take a side. */

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ side?: string }> };

async function load(props: Props) {
  const q = parseBetRef((await props.params).ref, (await props.searchParams).side ?? null);
  if (!q) return null;
  const m = (await arcMarketDetail(q.kind, q.id).catch(() => null)) as { question: string; labelA: string; labelB: string } | null;
  return m ? { ...q, m } : null;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const b = await load(props);
  if (!b) return { title: "Mimir Markets", robots: { index: false } };
  const side = b.side === 1 ? b.m.labelA : b.m.labelB;
  const title = `I took "${side}" on Mimir`;
  const description = `${b.m.question} Think they're wrong? Take the other side. An AI oracle settles it in the open.`;
  const image = { url: betCardUrl(b.kind, b.id, b.side), width: 1200, height: 630, alt: title };
  return {
    title: `${title} · Mimir Markets`,
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: betLink(b.kind, b.id, b.side) },
    openGraph: { title, description, url: betLink(b.kind, b.id, b.side), images: [image], type: "website", siteName: "Mimir Markets" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function BetPage(props: Props) {
  const b = await load(props);
  if (!b) notFound();
  const mine = b.side === 1 ? b.m.labelA : b.m.labelB;
  const other = b.side === 1 ? b.m.labelB : b.m.labelA;
  return (
    <div className="mx-auto grid max-w-[560px] gap-6 py-6">
      <header className="grid gap-3">
        <h1 className="m-0 font-display text-app-h1 text-cream">Someone took &ldquo;{mine}&rdquo;.</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted">{b.m.question}</p>
      </header>
      <section className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
        <p className="m-0 text-[14px] text-muted">
          Think they&apos;re wrong? Back <span className="text-cream">&ldquo;{other}&rdquo;</span>. An AI oracle settles it from the named source, in the open.
        </p>
        <Link href={`/arena/arc/${b.kind}/${b.id}`} className="justify-self-start rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] hover:brightness-110">
          Open the market
        </Link>
      </section>
    </div>
  );
}
