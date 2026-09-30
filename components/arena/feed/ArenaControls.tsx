"use client";

/**
 * The feed's one control row: view tabs with counts, a search pill and a
 * Filters button whose popover holds category, minimum stake and sort.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, SlidersHorizontal, X } from "lucide-react";
import Chip from "@/components/ui/Chip";
import Segmented from "@/components/ui/Segmented";
import {
  activeFilterCount,
  ARENA_VIEWS,
  DEFAULT_FILTERS,
  MIN_STAKE_PRESETS,
  parseMinStake,
  type ArenaFilters,
  type ArenaSort,
  type ArenaView,
} from "@/lib/arena-feed";

export default function ArenaControls({
  view,
  onView,
  counts,
  filters,
  onFilters,
  categories,
  resultCount,
}: {
  view: ArenaView;
  onView: (v: ArenaView) => void;
  /** Null while the feed loads: the tabs show no counts yet. */
  counts: Record<ArenaView, number> | null;
  filters: ArenaFilters;
  onFilters: (f: ArenaFilters) => void;
  categories: string[];
  resultCount: number;
}) {
  const t = useTranslations("arena.feed");
  const active = activeFilterCount(filters);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <Segmented
        label={t("viewsLabel")}
        value={view}
        onChange={onView}
        tone="maroon"
        className="md:w-[380px] md:flex-none"
        options={ARENA_VIEWS.map((v) => ({ value: v, label: t(`views.${v}`), count: counts?.[v] }))}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2 md:justify-end">
        <label className="relative min-w-0 flex-1 md:max-w-[320px]">
          <span className="sr-only">{t("search")}</span>
          <Search size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-dim" />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={t("search")}
            value={filters.search}
            onChange={(e) => onFilters({ ...filters, search: e.target.value })}
            className="input !min-h-[46px] !py-2.5 !pl-11 !pr-11 !text-[14px] [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.search ? (
            <button
              type="button"
              onClick={() => onFilters({ ...filters, search: "" })}
              aria-label={t("clearSearch")}
              className="press absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-cream"
            >
              <X size={15} aria-hidden />
            </button>
          ) : null}
        </label>
        <FiltersPopover
          filters={filters}
          onFilters={onFilters}
          categories={categories}
          resultCount={resultCount}
          active={active}
        />
      </div>
    </div>
  );
}

function FiltersPopover({
  filters,
  onFilters,
  categories,
  resultCount,
  active,
}: {
  filters: ArenaFilters;
  onFilters: (f: ArenaFilters) => void;
  categories: string[];
  resultCount: number;
  active: number;
}) {
  const t = useTranslations("arena.feed");
  const [open, setOpen] = useState(false);
  const [minDraft, setMinDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const minId = useId();

  // Keep the custom field in step with presets and resets.
  useEffect(() => {
    const preset = (MIN_STAKE_PRESETS as readonly number[]).includes(filters.minStake);
    setMinDraft(filters.minStake > 0 && !preset ? String(filters.minStake) : "");
  }, [filters.minStake]);

  useEffect(() => {
    if (!open) return;
    const panel = rootRef.current?.querySelector<HTMLElement>(`[id="${panelId}"]`);
    panel?.querySelector<HTMLElement>("button, input")?.focus();
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

  const set = (patch: Partial<ArenaFilters>) => onFilters({ ...filters, ...patch });
  const sortOptions: { value: ArenaSort; label: string }[] = [
    { value: "newest", label: t("sortNewest") },
    { value: "pool", label: t("sortPool") },
  ];

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      // Non-modal: Tab out of the panel closes it (a click inside on plain text has no relatedTarget and keeps it open).
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (open && next && !rootRef.current?.contains(next)) setOpen(false);
      }}
    >
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
        <span>{t("filters")}</span>
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
          className="glass-deep pop-in absolute right-0 top-[calc(100%+8px)] z-40 grid w-[min(360px,calc(100vw-2*var(--gut)))] gap-5 rounded-3xl bg-[rgb(14_7_9/.92)] p-5 shadow-modal"
        >
          <fieldset className="m-0 grid gap-2.5 border-0 p-0">
            <legend className="label !mb-2.5">{t("category")}</legend>
            <div className="flex flex-wrap gap-2">
              <Chip active={filters.category === "all"} onClick={() => set({ category: "all" })}>
                {t("all")}
              </Chip>
              {categories.map((c) => (
                <Chip key={c} active={filters.category === c} onClick={() => set({ category: c })} className="capitalize">
                  {c}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="m-0 grid gap-2.5 border-0 p-0">
            <legend className="label !mb-2.5">{t("minStake")}</legend>
            <div className="flex flex-wrap items-center gap-2">
              {MIN_STAKE_PRESETS.map((v) => (
                <Chip key={v} active={filters.minStake === v} onClick={() => set({ minStake: v })}>
                  {v === 0 ? t("any") : t("minStakePreset", { amount: v })}
                </Chip>
              ))}
              <label htmlFor={minId} className="sr-only">
                {t("minStakeCustom")}
              </label>
              <input
                id={minId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={minDraft}
                onChange={(e) => {
                  const v = e.target.value.replace(",", ".");
                  if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) setMinDraft(v);
                }}
                onBlur={() => set({ minStake: parseMinStake(minDraft) })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") set({ minStake: parseMinStake(minDraft) });
                }}
                className="input !min-h-[34px] !w-[88px] !px-3.5 !py-1.5 font-mono !text-[13px]"
              />
            </div>
          </fieldset>

          <div className="grid gap-2.5">
            <span className="label !mb-0">{t("sort")}</span>
            <Segmented
              as="toggle"
              size="sm"
              label={t("sort")}
              value={filters.sort}
              onChange={(v) => set({ sort: v })}
              options={sortOptions}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <button
              type="button"
              className="press rounded-full px-3 py-2 text-[14px] text-muted transition-colors hover:text-cream disabled:opacity-40"
              disabled={active === 0 && filters.sort === DEFAULT_FILTERS.sort}
              onClick={() => onFilters({ ...DEFAULT_FILTERS, search: filters.search })}
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
