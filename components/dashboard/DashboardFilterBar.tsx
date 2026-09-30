"use client";

/**
 * The positions control row: phase tabs with counts, a search pill, a
 * Filters popover (category, minimum own stake) and refresh. Every value
 * lives in the URL (`hooks/useDashboardFilterUrlState.ts`).
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";

import Chip from "@/components/ui/Chip";
import Segmented from "@/components/ui/Segmented";
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
  resultCount: number;
}

export default function DashboardFilterBar({ filters, counts, onChange, onRefresh, refreshing, resultCount }: Props) {
  const t = useTranslations("dashboard");

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <Segmented
        label={t("tabsAria")}
        value={filters.tab}
        onChange={(tab) => onChange({ tab })}
        tone="maroon"
        className="md:w-[440px] md:flex-none"
        options={DASHBOARD_TABS.map((tab) => ({ value: tab, label: t(`tabs.${tab}`), count: counts[tab] }))}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2 md:justify-end">
        <label className="relative min-w-0 flex-1 md:max-w-[280px]">
          <span className="sr-only">{t("searchLabel")}</span>
          <Search size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-dim" />
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder={t("searchPlaceholder")}
            className="input !min-h-[46px] !py-2.5 !pl-11 !pr-11 !text-[14px] [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.search ? (
            <button
              type="button"
              onClick={() => onChange({ search: "" })}
              aria-label={t("clearSearch")}
              className="press absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-cream"
            >
              <X size={15} aria-hidden />
            </button>
          ) : null}
        </label>
        <FiltersPopover filters={filters} onChange={onChange} resultCount={resultCount} />
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={t("refresh")}
          className="btn-ghost !min-h-[46px] !w-[46px] !flex-none !p-0 disabled:opacity-60"
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function FiltersPopover({
  filters,
  onChange,
  resultCount,
}: {
  filters: DashboardFilters;
  onChange: (patch: Partial<DashboardFilters>) => void;
  resultCount: number;
}) {
  const t = useTranslations("dashboard");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const active = (filters.cat !== "all" ? 1 : 0) + (filters.minStake > 0 ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    document.getElementById(panelId)?.querySelector<HTMLElement>("button")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, panelId]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={active ? t("filtersActive", { count: active }) : t("filters")}
        onClick={() => setOpen((o) => !o)}
        className="btn-ghost !min-h-[46px] !w-auto !gap-2 !px-4 !text-[17px]"
      >
        <SlidersHorizontal size={15} aria-hidden />
        <span className="max-sm:sr-only">{t("filters")}</span>
        {active ? (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1.5 font-mono text-[11px] text-[#160909]">
            {active}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("filters")}
          data-lenis-prevent
          className="glass-deep pop-in absolute right-0 top-[calc(100%+8px)] z-40 grid w-[min(340px,calc(100vw-2*var(--gut)))] gap-5 rounded-3xl bg-[rgb(14_7_9/.92)] p-5 shadow-modal"
        >
          <fieldset className="m-0 grid gap-2.5 border-0 p-0">
            <legend className="label !mb-2.5">{t("categoryLabel")}</legend>
            <div className="flex flex-wrap gap-2">
              <Chip active={filters.cat === "all"} onClick={() => onChange({ cat: "all" })}>
                {t("allCategories")}
              </Chip>
              {CATEGORIES.map((c) => (
                <Chip key={c.id} active={filters.cat === c.id} onClick={() => onChange({ cat: c.id })}>
                  {c.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="m-0 grid gap-2.5 border-0 p-0">
            <legend className="label !mb-2.5">{t("minStakeLabel")}</legend>
            <div className="flex flex-wrap gap-2">
              {DASHBOARD_MIN_STAKE_OPTIONS.map((n) => (
                <Chip key={n} active={filters.minStake === n} onClick={() => onChange({ minStake: n })}>
                  {n === 0 ? t("anyStake") : t("minStake", { n })}
                </Chip>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <button
              type="button"
              className="press rounded-full px-3 py-2 text-[14px] text-muted transition-colors hover:text-cream disabled:opacity-40"
              disabled={active === 0}
              onClick={() => onChange({ cat: "all", minStake: 0 })}
            >
              {t("reset")}
            </button>
            <button
              type="button"
              className="btn-light !min-h-[40px] !w-auto !px-5 !text-[14px]"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              {t("done", { count: resultCount })}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
