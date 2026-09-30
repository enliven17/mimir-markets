"use client";

/**
 * Everything below the hero, one tab at a time: Evidence, Council,
 * Challengers, Terms. A panel mounts the first time its tab opens (the council
 * read waits until someone looks) and stays mounted after.
 */
import { SURFACE } from "@/components/arena/surface";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Segmented } from "@/components/ui";

export type DetailTab = "evidence" | "council" | "people" | "terms";
const TABS: DetailTab[] = ["evidence", "council", "people", "terms"];

export default function DetailTabs({
  panels,
  counts = {},
  className = "",
}: {
  panels: Record<DetailTab, ReactNode>;
  counts?: Partial<Record<DetailTab, number>>;
  className?: string;
}) {
  const t = useTranslations("arena.detail");
  const [tab, setTab] = useState<DetailTab>("evidence");
  const [opened, setOpened] = useState<Set<DetailTab>>(() => new Set<DetailTab>(["evidence"]));

  const select = (next: DetailTab) => {
    setTab(next);
    setOpened((s) => (s.has(next) ? s : new Set(s).add(next)));
  };

  return (
    <section aria-label={t("tabsLabel")} className={`grid min-w-0 content-start gap-4 ${className}`}>
      <Segmented
        label={t("tabsLabel")}
        value={tab}
        onChange={select}
        size="sm"
        options={TABS.map((v) => ({ value: v, label: t(`tabs.${v}`), count: counts[v] }))}
      />
      {TABS.map((v) =>
        opened.has(v) ? (
          <div key={v} role="tabpanel" aria-label={t(`tabs.${v}`)} hidden={tab !== v} className={`${SURFACE} fade-rise p-5 sm:p-6`}>
            {panels[v]}
          </div>
        ) : null,
      )}
    </section>
  );
}
