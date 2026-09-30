import { useTranslations } from "next-intl";
import StatsHeader from "@/components/stats/StatsHeader";
import StatsClient from "./StatsClient";

/** /stats: the shared stats header, then the live totals, confidence split and recent settlements. */
export default function StatsPage() {
  const t = useTranslations("stats");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <StatsHeader current="/stats" lead={t("lead")} />
      <StatsClient />
    </div>
  );
}
