import { getTranslations, setRequestLocale } from "next-intl/server";
import StatsHeader from "@/components/stats/StatsHeader";
import StatsClient from "./StatsClient";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/stats",
  title: "Stats · Mimir Markets",
  description: "Live numbers from Mimir: markets opened and settled, volume staked on Arc and how the oracle has decided.",
});


/** /stats: the shared stats header, then the live totals, confidence split and recent settlements. */
export default async function StatsPage({ params }: { params: Promise<{ locale: string }> }) {
  // Static like before: the locale comes from the segment, not the request.
  setRequestLocale((await params).locale);
  const t = await getTranslations("stats");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <StatsHeader current="/stats" lead={t("lead")} />
      <StatsClient />
    </div>
  );
}
