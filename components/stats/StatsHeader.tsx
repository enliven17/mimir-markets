import { useTranslations } from "next-intl";
import SegmentedNav from "@/components/ui/SegmentedNav";

/** Shared header for /stats and /calibration: one title, one line, a segmented switch. */
export default function StatsHeader({ current, lead }: { current: "/stats" | "/calibration"; lead: string }) {
  const t = useTranslations("stats");
  return (
    <header className="grid gap-4 sm:flex sm:items-start sm:justify-between">
      <div className="grid min-w-0 gap-2">
        <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
        <p className="m-0 max-w-[60ch] text-[15px] leading-relaxed text-muted">{lead}</p>
      </div>
      <SegmentedNav
        label={t("tabsLabel")}
        current={current}
        className="w-full flex-none sm:w-[300px]"
        items={[
          { href: "/stats", label: t("tabOverview") },
          { href: "/calibration", label: t("tabCalibration") },
        ]}
      />
    </header>
  );
}
