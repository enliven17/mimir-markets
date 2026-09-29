"use client";

/**
 * Tabs (all / live / settling / done) with counts, a search field, and
 * category + minimum own-stake selects for the dashboard position list.
 */
import type { KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Search, X } from "lucide-react";

import { CATEGORIES } from "@/lib/constants";
import {
  DASHBOARD_MIN_STAKE_OPTIONS,
  DASHBOARD_TABS,
  type DashboardFilters,
  type DashboardTab,
} from "@/lib/dashboard-positions";

interface Props {
  filters: DashboardFilters;
  counts: Record<DashboardTab, number>;
  onChange: (patch: Partial<DashboardFilters>) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

const selectClass = "input !w-auto !py-2 font-mono text-xs";

export default function DashboardFilterBar({ filters, counts, onChange, onRefresh, refreshing }: Props) {
  const t = useTranslations("dashboard");

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = DASHBOARD_TABS.indexOf(filters.tab);
    const next =
      e.key === "ArrowRight" ? DASHBOARD_TABS[(i + 1) % DASHBOARD_TABS.length]
      : e.key === "ArrowLeft" ? DASHBOARD_TABS[(i - 1 + DASHBOARD_TABS.length) % DASHBOARD_TABS.length]
      : e.key === "Home" ? DASHBOARD_TABS[0]
      : e.key === "End" ? DASHBOARD_TABS[DASHBOARD_TABS.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    onChange({ tab: next });
    (e.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLButtonElement | null)?.focus();
  };

  return (
    <div className="space-y-3 border-b border-pv-border/25 px-4 py-4 sm:px-6">
      <div role="tablist" aria-label={t("tabsAria")} onKeyDown={onTabKey} className="grid grid-cols-2 gap-px border border-pv-border/25 bg-pv-border/25 sm:grid-cols-4">
        {DASHBOARD_TABS.map((tab) => {
          const active = filters.tab === tab;
          return (
            <button
              key={tab}
              data-tab={tab}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange({ tab })}
              className={`flex min-h-[44px] items-center justify-between gap-2 px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-ring ${
                active ? "bg-pv-emerald/[0.14] text-pv-text shadow-[inset_0_-2px_0_0_rgb(var(--pv-accent))]" : "bg-pv-bg text-pv-muted hover:bg-pv-surface hover:text-pv-text"
              }`}
            >
              {t(`tabs.${tab}`)}
              <span className="font-mono text-[11px] tabular-nums">{counts[tab]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">{t("searchLabel")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-pv-muted" aria-hidden />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder={t("searchPlaceholder")}
            className="input !py-2 !pl-8 !pr-8 text-sm"
          />
          {filters.search ? (
            <button
              type="button"
              onClick={() => onChange({ search: "" })}
              aria-label={t("clearSearch")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-pv-muted hover:text-pv-text focus-ring"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </label>
        <label className="flex items-center gap-2">
          <span className="sr-only">{t("categoryLabel")}</span>
          <select value={filters.cat} onChange={(e) => onChange({ cat: e.target.value })} className={selectClass}>
            <option value="all">{t("allCategories")}</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="sr-only">{t("minStakeLabel")}</span>
          <select value={filters.minStake} onChange={(e) => onChange({ minStake: Number(e.target.value) })} className={selectClass}>
            {DASHBOARD_MIN_STAKE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t("anyStake") : t("minStake", { n })}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={t("refresh")}
          className="inline-flex h-10 w-10 items-center justify-center border border-pv-border/25 text-pv-muted transition-colors hover:border-pv-emerald/50 hover:text-pv-text disabled:opacity-60 focus-ring"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
        </button>
      </div>
    </div>
  );
}
