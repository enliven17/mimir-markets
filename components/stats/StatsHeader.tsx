import { useTranslations } from "next-intl";

/** The /stats header: one title, one line. */
export default function StatsHeader({ lead }: { lead: string }) {
  const t = useTranslations("stats");
  return (
    <header className="grid min-w-0 gap-2">
      <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
      <p className="m-0 max-w-[60ch] text-[15px] leading-relaxed text-muted">{lead}</p>
    </header>
  );
}
