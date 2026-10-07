"use client";

import { notFound, useParams } from "next/navigation";

import ArcMarketView from "@/components/arc/arena/ArcMarketView";

export default function ArcMarketPage() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const marketId = Number(id);
  if ((kind !== "vs" && kind !== "pool") || !Number.isSafeInteger(marketId) || marketId < 1) notFound();
  return <ArcMarketView kind={kind} marketId={marketId} />;
}
