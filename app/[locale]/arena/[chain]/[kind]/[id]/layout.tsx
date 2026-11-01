import type { ReactNode } from "react";

import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbs, pageMeta } from "@/lib/seo";
import { cardUrl, type CardKind } from "@/lib/telegram-card";
import { isMarketChainId, marketChain } from "@/lib/chains/registry";
import { marketPath } from "@/lib/chains/links";
import { arcMarketDetail } from "@/lib/server/arc-index";
import { toPublic, type IndexedMarket } from "@/lib/server/public-markets";

type Params = Promise<{ chain: string; kind: string; id: string }>;

async function load(chain: string, kind: string, id: string) {
  const marketId = Number(id);
  if (!isMarketChainId(chain) || (kind !== "vs" && kind !== "pool") || !Number.isSafeInteger(marketId) || marketId < 0) return null;
  const m = await arcMarketDetail(kind, marketId, chain).catch(() => null);
  return m ? toPublic(m as unknown as IndexedMarket, Math.floor(Date.now() / 1000)) : null;
}

/** Each market's own title, description and canonical, from the backend index. */
export async function generateMetadata({ params }: { params: Params }) {
  const { chain, kind, id } = await params;
  const m = await load(chain, kind, id);
  const path = marketPath(isMarketChainId(chain) ? chain : "arc", kind as "vs" | "pool", id);
  if (!m) return pageMeta({ path, title: "Market · Mimir Markets", description: "A prediction market on Mimir.", index: false });
  const when = new Date(m.deadline * 1000).toUTCString().slice(5, 22);
  const state = m.phase === "resolved" ? "Settled" : m.phase === "cancelled" ? "Cancelled" : m.phase === "open" ? "Open" : "Settling";
  const meta = pageMeta({
    path,
    title: `${m.question.slice(0, 90)} · Mimir Markets`,
    description: `${state} on ${marketChain(m.chain).label}. ${m.sideA.label}: ${m.sideA.usdc} USDC vs ${m.sideB.label}: ${m.sideB.usdc} USDC, ${m.participants} in. Deadline ${when} UTC.`.slice(0, 155),
  });
  // The link preview is this market's own card (question, both sides, the pot), not the site card.
  const image = { url: cardUrl("share", kind as CardKind, Number(id), undefined, undefined, m.chain), width: 1200, height: 630, alt: m.question.slice(0, 120) };
  return { ...meta, openGraph: { ...meta.openGraph, images: [image] }, twitter: { ...meta.twitter, images: [image] } };
}

export default async function MarketLayout({ children, params }: { children: ReactNode; params: Params }) {
  const { chain, kind, id } = await params;
  const m = await load(chain, kind, id);
  return (
    <>
      {m ? <JsonLd data={breadcrumbs([{ name: "Arena", path: "/arena" }, { name: m.question.slice(0, 80), path: marketPath(m.chain, m.kind, m.marketId) }])} /> : null}
      {children}
    </>
  );
}
