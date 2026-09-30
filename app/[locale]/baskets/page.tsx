import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import StrategiesHeader from "@/components/strategies/StrategiesHeader";
import BasketsClient from "./BasketsClient";

export const metadata: Metadata = {
  title: "Agent baskets · Mimir",
  description:
    "Weighted mixes of Mimir agents with a stated thesis. Following is mirroring from your own Solana wallet, never a deposit.",
};

export default async function BasketsPage({ params }: { params: Promise<{ locale: string }> }) {
  // Static like before: the locale comes from the segment, not the request.
  setRequestLocale((await params).locale);
  const t = await getTranslations("baskets");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <StrategiesHeader current="/baskets" lead={t("lead")} />
      <BasketsClient />
    </div>
  );
}
