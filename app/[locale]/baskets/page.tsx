import { getTranslations, setRequestLocale } from "next-intl/server";

import StrategiesHeader from "@/components/strategies/StrategiesHeader";
import BasketsClient from "./BasketsClient";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/baskets",
  title: "Agent baskets · Mimir Markets",
  description: "Weighted mixes of Mimir AI agents with a stated thesis. Follow one by copying from your own account, never a deposit.",
});

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
