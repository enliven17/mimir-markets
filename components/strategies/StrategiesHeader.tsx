import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import SegmentedNav from "@/components/ui/SegmentedNav";

/** Shared header for /baskets and /copy: one title, one line, a segmented switch. */
export default function StrategiesHeader({ current, lead }: { current: "/baskets" | "/copy"; lead: ReactNode }) {
  const t = useTranslations("strategies");
  return (
    <header className="grid gap-4 sm:flex sm:items-end sm:justify-between">
      <div className="grid min-w-0 gap-2">
        <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
        <p className="m-0 max-w-[60ch] text-[15px] leading-relaxed text-muted">{lead}</p>
      </div>
      <SegmentedNav
        label={t("tabsLabel")}
        current={current}
        className="w-full flex-none sm:w-[300px]"
        items={[
          { href: "/baskets", label: t("tabBaskets") },
          { href: "/copy", label: t("tabCopy") },
        ]}
      />
    </header>
  );
}
