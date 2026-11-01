import { notFound } from "next/navigation";

import ArcMarketView from "@/components/arc/arena/ArcMarketView";
import { isMarketChainId } from "@/lib/chains/registry";
import { cardUrl, type CardKind } from "@/lib/telegram-card";
import { generateMetadata as marketMetadata } from "./layout";

type Params = Promise<{ locale: string; chain: string; kind: string; id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** A win shared from the portfolio (?won=1|2) previews as the winner card with that side marked; else the layout's. */
export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { chain, kind, id } = await params;
  const meta = await marketMetadata({ params });
  const won = (await searchParams).won;
  if ((won !== "1" && won !== "2") || (kind !== "vs" && kind !== "pool") || !isMarketChainId(chain)) return meta;
  const image = { url: cardUrl("winner", kind as CardKind, Number(id), Number(won), undefined, chain), width: 1200, height: 630, alt: "Called it on Mimir" };
  return { ...meta, openGraph: { ...meta.openGraph, images: [image] }, twitter: { ...meta.twitter, images: [image] } };
}

/** /arena/<chain>/<kind>/<id>: one market on Base or Arc (/arena/arc/... is every link from before Base). */
export default async function MarketPage({ params }: { params: Params }) {
  const { chain, kind, id } = await params;
  const marketId = Number(id);
  if (!isMarketChainId(chain) || (kind !== "vs" && kind !== "pool") || !Number.isSafeInteger(marketId) || marketId < 1) notFound();
  return <ArcMarketView chain={chain} kind={kind} marketId={marketId} />;
}
