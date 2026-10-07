"use client";

import { useParams } from "next/navigation";

import ArcMarketView from "@/components/arc/arena/ArcMarketView";
import { Link } from "@/i18n/navigation";

export default function ArcMarketPage() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const marketId = Number(id);
  if ((kind !== "vs" && kind !== "pool") || !Number.isSafeInteger(marketId) || marketId < 1) {
    return (
      <p className="py-16 text-center text-muted">
        No such market. <Link href="/arena" className="text-coral hover:underline">Back to the Arena</Link>
      </p>
    );
  }
  return <ArcMarketView kind={kind} marketId={marketId} />;
}
