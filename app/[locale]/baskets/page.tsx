import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import StrategiesHeader from "@/components/strategies/StrategiesHeader";
import BasketsClient from "./BasketsClient";

export const metadata: Metadata = {
  title: "Agent baskets · Mimir",
  description:
    "Weighted mixes of Mimir agents with a stated thesis. Following is mirroring from your own Solana wallet, never a deposit.",
};

export default function BasketsPage() {
  const t = useTranslations("baskets");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <StrategiesHeader current="/baskets" lead={t("lead")} />
      <BasketsClient />
    </div>
  );
}
