"use client";

/**
 * /arena — Mimir on Solana: the explorer feed.
 *
 * Pixel-faithful port of the original Mimir explorer (ExploreClient.tsx),
 * driven entirely by Solana claim data. The original three-tab control bar,
 * sort/quick-filter dropdowns, search field, advanced category + min-stake
 * row, and the responsive ArenaCard grid are reproduced verbatim where the
 * data allows.
 *
 * The feed polls GET /api/arena/claims every 4s. Claims delegated to the
 * MagicBlock Ephemeral Rollup surface under the "LIVE ON ER" tab.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useParams } from "next/navigation";
import { ChevronDown, ListFilter, Plus, RefreshCw, Search, X } from "lucide-react";
import { Link } from "@/i18n/navigation";

import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { ArenaCardSkeleton } from "@/components/ui";
import { BlueprintHeading, BlueprintStat } from "@/components/BlueprintGrid";
import ClaimCard, { type SolanaClaim } from "@/components/arena/ClaimCard";
import ExploreArenaEmptyState from "@/components/explorer/ExploreArenaEmptyState";
import ExploreFilteredEmptyState from "@/components/explorer/ExploreFilteredEmptyState";
import { formatUsdcUnitsBare as usdc } from "@/lib/money";
import { isArchivedState, isLiveState } from "@/lib/claim-status";

const filterPillBase =
  "shrink-0 rounded border px-4 py-2 font-display text-xs font-bold uppercase tracking-tight transition-[color,border-color,background-color] focus-ring";
const filterPillActive = "border-pv-emerald/50 bg-pv-emerald text-pv-bg";
const filterPillInactive =
  "border-pv-border/[0.15] bg-transparent text-pv-muted hover:border-pv-border/[0.28] hover:text-pv-text";

// Original had Open / AI-signals / Closed. Solana has no AI-signals feed, so
// we keep the same control-bar visual with: Arena Live (open) / Resolved /
// Live on ER (delegated, still open). PROVING GROUND tab dropped.
type ArenaViewMode = "open" | "resolved" | "live";
type ArenaSort = "newest" | "highest";

const MIN_STAKE_OPTIONS = [0, 5, 25, 100] as const;

interface ArenaData {
  claims: SolanaClaim[];
  claimCount: number;
  totalResolved: number;
  openPool: string;
}

function poolUnits(claim: SolanaClaim): number {
  return Number(claim.creatorStake) + Number(claim.totalChallengerStake);
}

// Live board: OPEN / ACTIVE. Archive: a verdict is in (PROPOSED, DISPUTED,
// RESOLVED) or the claim was cancelled — cards label each phase.
const isOpenState = isLiveState;
const isResolvedState = isArchivedState;

export default function ArenaPage() {
  const { locale } = useParams<{ locale: string }>();

  const [claims, setClaims] = useState<SolanaClaim[] | null>(null);
  const [stats, setStats] = useState({
    claimCount: 0,
    totalResolved: 0,
    openPool: "0",
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter state — plain useState replacements for the archived
  // useExploreFilterState / applyExploreFilters helpers.
  const [activeView, setActiveView] = useState<ArenaViewMode>("open");
  const [cat, setCat] = useState<string>("all");
  const [sort, setSort] = useState<ArenaSort>("newest");
  const [search, setSearch] = useState("");
  const [minStake, setMinStake] = useState(0);
  const [minDraft, setMinDraft] = useState("");

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [quickFilterMenuOpen, setQuickFilterMenuOpen] = useState(false);
  const [, startViewTransition] = useTransition();

  const sortMenuRef = useRef<HTMLDivElement>(null);
  const quickFilterMenuRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);

  const loadArenaData = useMemo(
    () =>
      async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
        if (forceRefresh) setRefreshing(true);
        try {
          const res = await fetch("/api/arena/claims", { cache: "no-store" });
          const json = await res.json();
          if (aliveRef.current && json.success) {
            const data = json.data as ArenaData;
            setClaims(data.claims);
            setStats({
              claimCount: data.claimCount,
              totalResolved: data.totalResolved,
              openPool: data.openPool,
            });
          }
        } catch (error) {
          console.error("Failed to load arena claims:", error);
          // keep last good state
        } finally {
          if (aliveRef.current) {
            setLoading(false);
            if (forceRefresh) setRefreshing(false);
          }
        }
      },
    []
  );

  useEffect(() => {
    aliveRef.current = true;
    void loadArenaData();
    const interval = setInterval(() => void loadArenaData(), 4000);
    return () => {
      aliveRef.current = false;
      clearInterval(interval);
    };
  }, [loadArenaData]);

  // Categories derived from the claims actually present.
  const categories = useMemo(() => {
    if (!claims) return [];
    const seen = new Set<string>();
    for (const claim of claims) {
      const c = (claim.category ?? "").trim();
      if (c) seen.add(c);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [claims]);

  const applyShared = useMemo(
    () => (list: SolanaClaim[]) => {
      let next = list;

      if (cat !== "all") {
        next = next.filter((claim) => claim.category === cat);
      }

      if (minStake > 0) {
        next = next.filter(
          (claim) => Number(claim.creatorStake) / 1e6 >= minStake
        );
      }

      const query = search.trim().toLowerCase();
      if (query) {
        next = next.filter((claim) =>
          claim.question.toLowerCase().includes(query)
        );
      }

      const sorted = [...next];
      if (sort === "highest") {
        sorted.sort((a, b) => poolUnits(b) - poolUnits(a));
      } else {
        sorted.sort((a, b) => b.id - a.id);
      }
      return sorted;
    },
    [cat, minStake, search, sort]
  );

  const openChallenges = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return applyShared((claims ?? []).filter((c) => isOpenState(c.state) && c.deadline > now));
  }, [applyShared, claims]);

  const resolvedChallenges = useMemo(
    () => applyShared((claims ?? []).filter((c) => isResolvedState(c.state))),
    [applyShared, claims]
  );

  const liveChallenges = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return applyShared(
      (claims ?? []).filter((c) => c.delegated && isOpenState(c.state) && c.deadline > now)
    );
  }, [applyShared, claims]);

  const hasActiveFilters =
    cat !== "all" || minStake !== 0 || search.trim().length > 0;

  const sortOnlyOptions: { key: ArenaSort; label: string }[] = useMemo(
    () => [
      { key: "newest", label: "Newest" },
      { key: "highest", label: "Highest stake" },
    ],
    []
  );

  const sortTriggerLabel = useMemo(
    () =>
      sortOnlyOptions.find((option) => option.key === sort)?.label ??
      sortOnlyOptions[0].label,
    [sort, sortOnlyOptions]
  );

  // The original quick-filter menu offered Needs-challengers / Expiring-soon /
  // Strength — all EVM-specific. On Solana the cleanest equivalent is the
  // delegated "Live on ER" cut, expressed through the view tab. We keep the
  // dropdown visual with the always-applicable "All" choice only.
  const quickFilterTriggerLabel = "All";

  useEffect(() => {
    if (minStake === 0) {
      setMinDraft("");
    } else if (Number.isInteger(minStake)) {
      setMinDraft(String(minStake));
    } else {
      setMinDraft(minStake.toFixed(2));
    }
  }, [minStake]);

  const commitMinDraft = () => {
    const raw = minDraft.trim().replace(",", ".");
    if (raw === "") {
      setMinStake(0);
      setMinDraft("");
      return;
    }
    const n = Number(raw);
    const next = Number.isFinite(n) && n > 0 ? n : 0;
    setMinStake(next);
    if (next === 0) {
      setMinDraft("");
    } else if (Number.isInteger(next)) {
      setMinDraft(String(next));
    } else {
      setMinDraft(next.toFixed(2));
    }
  };

  const handleMinInputChange = (value: string) => {
    const normalized = value.replace(",", ".");
    if (normalized === "") {
      setMinDraft("");
      return;
    }
    if (/^\d*\.?\d{0,2}$/.test(normalized)) {
      setMinDraft(normalized);
    }
  };

  useEffect(() => {
    if (!sortMenuOpen && !quickFilterMenuOpen) return;

    const onDoc = (event: MouseEvent) => {
      const node = event.target as Node;
      if (
        sortMenuRef.current?.contains(node) ||
        quickFilterMenuRef.current?.contains(node)
      ) {
        return;
      }
      setSortMenuOpen(false);
      setQuickFilterMenuOpen(false);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortMenuOpen(false);
        setQuickFilterMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [quickFilterMenuOpen, sortMenuOpen]);

  const switchView = (nextView: ArenaViewMode) => {
    startViewTransition(() => {
      setActiveView(nextView);
    });
  };

  const tabLabel: Record<ArenaViewMode, string> = {
    open: "ARENA LIVE",
    resolved: "RESOLVED",
    live: "LIVE ON ER",
  };

  const activeBandCopy =
    activeView === "open"
      ? {
          eyebrow: tabLabel.open,
          title: "READY TO CHALLENGE",
          hint: "Live claims open for a rival right now. Review the terms, inspect the source, and enter the arena.",
        }
      : activeView === "resolved"
        ? {
            eyebrow: tabLabel.resolved,
            title: "SETTLED CLAIMS",
            hint: "Markets the oracle has settled or refunded. Each card opens to the on-chain settlement receipt.",
          }
        : {
            eyebrow: tabLabel.live,
            title: "LIVE ON THE EPHEMERAL ROLLUP",
            hint: "Claims delegated to the MagicBlock Ephemeral Rollup — challenges are zero-fee and land in ~30ms.",
          };

  const renderGrid = (
    list: SolanaClaim[],
    options: {
      isResolvedView?: boolean;
    } = {}
  ) => {
    if (loading) {
      return (
        <div className="bp-cells grid-cols-1 border-b border-pv-border/25 sm:grid-cols-2 lg:grid-cols-3">
          <ArenaCardSkeleton />
          <ArenaCardSkeleton />
          <ArenaCardSkeleton />
        </div>
      );
    }

    if (list.length === 0) {
      if (hasActiveFilters) {
        return (
          <ExploreFilteredEmptyState
            eyebrow="Zero matches"
            title="No challenges match these filters"
            description="Reset filters, broaden your search, or publish a new challenge."
            resetLabel="Reset filters"
            onReset={() => {
              setCat("all");
              setSort("newest");
              setSearch("");
              setMinStake(0);
              setMinDraft("");
            }}
          />
        );
      }

      if (options.isResolvedView) {
        return (
          <ExploreArenaEmptyState
            eyebrow="No settled markets yet"
            title="The oracle hasn't closed any claims here"
            description="Settled claims appear once the deadline passes and the oracle posts a verdict on chain."
            ctaLabel="HOW IT WORKS"
            ctaHref="/docs"
          />
        );
      }

      return (
        <ExploreArenaEmptyState
          eyebrow="Empty arena"
          title="No open challenges right now"
          description="The market-creator agent opens new claims periodically. You can also publish your own challenge."
          ctaLabel="PUBLISH CHALLENGE"
          ctaHref="/arena/create"
        />
      );
    }

    return (
      <div className="bp-cells grid-cols-1 border-b border-pv-border/25 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((claim) => (
          <motion.div
            className="bp-cell h-full"
            key={claim.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
          >
            <ClaimCard claim={claim} locale={locale} />
          </motion.div>
        ))}
      </div>
    );
  };

  const tabConfig: { view: ArenaViewMode; count: number }[] = [
    { view: "open", count: openChallenges.length },
    { view: "resolved", count: resolvedChallenges.length },
    { view: "live", count: liveChallenges.length },
  ];

  return (
    <PageTransition>
      <AnimatedItem>
        <BlueprintHeading
          as="h1"
          eyebrow="Solana devnet · MagicBlock ER"
          subtitle="Pick your fight. Accept someone else's stake — every claim settles on-chain against the evidence."
        >
          The arena
        </BlueprintHeading>
        <div className="bp-grid grid-cols-3 border-b border-pv-border/25">
          <BlueprintStat value={stats.claimCount} label="Markets" />
          <BlueprintStat value={stats.totalResolved} label="Resolved" />
          <BlueprintStat value={`$${usdc(stats.openPool)}`} label="Open pool" tone="gold" />
        </div>
      </AnimatedItem>

      {/* z-20: filter dropdowns (absolute z-[100]) must stack above
          #arena-content — Framer-motion siblings create stacking contexts. */}
      <AnimatedItem className="relative z-20">
        <section
          id="arena-controls"
          className="border-b border-pv-border/25"
          aria-label="Filters: category, minimum stake, and sort order"
        >
          <div>
            <div className="flex flex-col gap-5 border-b border-pv-border/25 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-pv-muted">
                  {activeBandCopy.eyebrow}
                </p>
                <div>
                  <h2 className="font-display text-xl font-bold uppercase tracking-tight text-pv-text sm:text-2xl">
                    {activeBandCopy.title}
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-pv-muted">
                    {activeBandCopy.hint}
                  </p>
                </div>
              </div>

              <div className="grid w-full grid-cols-1 gap-px border border-pv-border/25 bg-pv-border/25 sm:w-auto sm:grid-cols-3">
                {tabConfig.map(({ view, count }) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => switchView(view)}
                    aria-pressed={activeView === view}
                    className={`flex min-h-[48px] items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-200 focus-ring sm:min-w-[180px] ${
                      activeView === view
                        ? "bg-pv-emerald/[0.14] shadow-[inset_0_-2px_0_0_rgb(var(--pv-accent))]"
                        : "bg-pv-bg hover:bg-pv-surface"
                    }`}
                  >
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-pv-text">
                      {tabLabel[view]}
                    </span>
                    <span
                      className={`px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${
                        activeView === view
                          ? "bg-pv-emerald text-pv-bg"
                          : "border border-pv-border/25 text-pv-muted"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="px-4 py-5 sm:px-6">
              <div className="grid grid-cols-2 gap-3 gap-y-4 lg:grid-cols-12 lg:items-end lg:gap-4 xl:gap-5">
                <div
                  className="relative col-span-1 min-w-0 lg:col-span-2"
                  ref={sortMenuRef}
                >
                  <label
                    id="explore-sort-label"
                    htmlFor="explore-sort-trigger"
                    className="label"
                  >
                    SORT BY
                  </label>
                  <button
                    type="button"
                    id="explore-sort-trigger"
                    aria-label="Sort order"
                    aria-expanded={sortMenuOpen}
                    aria-haspopup="listbox"
                    aria-controls="explore-sort-listbox"
                    onClick={() => {
                      setQuickFilterMenuOpen(false);
                      setSortMenuOpen((open) => !open);
                    }}
                    className="input flex h-11 min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 bg-pv-bg py-0 pr-3 text-left font-body text-sm text-pv-text transition-[border-color,box-shadow] hover:border-pv-border/[0.14]"
                  >
                    <span className="min-w-0 truncate">{sortTriggerLabel}</span>
                    <ChevronDown
                      size={18}
                      className={`shrink-0 text-pv-muted transition-transform duration-200 ${
                        sortMenuOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden
                    />
                  </button>
                  <AnimatePresence>
                    {sortMenuOpen ? (
                      <motion.div
                        key="explore-sort-listbox"
                        id="explore-sort-listbox"
                        role="listbox"
                        aria-labelledby="explore-sort-label"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{
                          duration: 0.16,
                          ease: [0.25, 0.46, 0.45, 0.94],
                        }}
                        className="absolute left-0 top-full z-[100] mt-1.5 w-max min-w-full max-w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded border border-pv-border/25 bg-pv-bg py-1 shadow-[0_16px_48px_-20px_rgba(0,0,0,0.5)]"
                      >
                        {sortOnlyOptions.map(({ key, label }) => (
                          <button
                            key={key}
                            type="button"
                            role="option"
                            aria-selected={sort === key}
                            onClick={() => {
                              setSort(key);
                              setSortMenuOpen(false);
                            }}
                            className={`flex w-full items-center px-4 py-2.5 text-left font-body text-sm transition-colors ${
                              sort === key
                                ? "bg-pv-emerald/[0.12] font-medium text-pv-emerald"
                                : "text-pv-muted hover:bg-pv-border/[0.05] hover:text-pv-text"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>

                <div
                  className="relative col-span-1 min-w-0 lg:col-span-2"
                  ref={quickFilterMenuRef}
                >
                  <label
                    id="explore-quick-filter-label"
                    htmlFor="explore-quick-filter-trigger"
                    className="label"
                  >
                    FILTER
                  </label>
                  <button
                    type="button"
                    id="explore-quick-filter-trigger"
                    aria-label="Filter view"
                    aria-expanded={quickFilterMenuOpen}
                    aria-haspopup="listbox"
                    aria-controls="explore-quick-filter-listbox"
                    onClick={() => {
                      setSortMenuOpen(false);
                      setQuickFilterMenuOpen((open) => !open);
                    }}
                    className="input flex h-11 min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 bg-pv-bg py-0 pr-3 text-left font-body text-sm text-pv-text transition-[border-color,box-shadow] hover:border-pv-border/[0.14]"
                  >
                    <span className="min-w-0 truncate">
                      {quickFilterTriggerLabel}
                    </span>
                    <ChevronDown
                      size={18}
                      className={`shrink-0 text-pv-muted transition-transform duration-200 ${
                        quickFilterMenuOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden
                    />
                  </button>
                  <AnimatePresence>
                    {quickFilterMenuOpen ? (
                      <motion.div
                        key="explore-quick-filter-listbox"
                        id="explore-quick-filter-listbox"
                        role="listbox"
                        aria-labelledby="explore-quick-filter-label"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{
                          duration: 0.16,
                          ease: [0.25, 0.46, 0.45, 0.94],
                        }}
                        className="absolute left-0 top-full z-[100] mt-1.5 w-max min-w-full max-w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded border border-pv-border/25 bg-pv-bg py-1 shadow-[0_16px_48px_-20px_rgba(0,0,0,0.5)]"
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected
                          onClick={() => setQuickFilterMenuOpen(false)}
                          className="flex w-full items-center bg-pv-emerald/[0.12] px-4 py-2.5 text-left font-body text-sm font-medium text-pv-emerald transition-colors"
                        >
                          All
                        </button>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>

                <div className="col-span-1 min-w-0 w-full max-w-[7.875rem] lg:col-span-2 lg:w-3/4 lg:max-w-none lg:justify-self-start">
                  <label htmlFor="explore-min-stake" className="label">
                    MIN STAKE
                  </label>
                  <input
                    id="explore-min-stake"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    aria-label="Minimum stake amount"
                    value={minDraft}
                    onChange={(event) => handleMinInputChange(event.target.value)}
                    onBlur={commitMinDraft}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    className="input h-11 min-h-[44px] w-full max-w-full bg-pv-bg py-2.5 font-mono text-sm tabular-nums"
                  />
                </div>

                <div className="col-span-2 flex min-w-0 flex-col gap-3 lg:col-span-6 lg:flex-row lg:items-end lg:gap-3">
                  <div className="flex min-w-0 w-full flex-col lg:flex-1">
                    <label htmlFor="explore-search" className="label">
                      SEARCH
                    </label>
                    <div className="relative min-w-0 w-full">
                      <Search
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-pv-muted"
                        aria-hidden
                      />
                      <input
                        id="explore-search"
                        type="text"
                        inputMode="search"
                        enterKeyHint="search"
                        autoComplete="off"
                        placeholder="Search Markets, Assets, or Teams."
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className={`input h-11 min-h-[44px] bg-pv-bg py-2.5 pl-10 font-body text-sm ${
                          search ? "pr-11" : ""
                        }`}
                      />
                      {search ? (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 z-[1] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-pv-muted transition-colors hover:bg-pv-border/[0.06] hover:text-pv-text focus-ring"
                          onClick={() => setSearch("")}
                          aria-label="Clear search"
                        >
                          <X size={16} strokeWidth={2} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((open) => !open)}
                    aria-expanded={advancedOpen}
                    className="flex h-11 min-h-[44px] w-full shrink-0 items-center justify-center gap-2 border border-pv-border/25 bg-pv-bg px-5 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-pv-text transition-colors hover:border-pv-emerald/30 hover:bg-pv-border/[0.04] lg:w-auto"
                  >
                    <ListFilter
                      size={16}
                      className="text-pv-muted"
                      aria-hidden
                    />
                    ADVANCED
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void loadArenaData({ forceRefresh: true });
                    }}
                    disabled={refreshing}
                    aria-busy={refreshing}
                    className="flex h-11 min-h-[44px] w-full shrink-0 items-center justify-center gap-2 border border-pv-border/25 bg-pv-bg px-5 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-pv-text transition-colors hover:border-pv-emerald/30 hover:bg-pv-border/[0.04] disabled:cursor-wait disabled:opacity-70 lg:w-auto"
                  >
                    <RefreshCw
                      size={16}
                      className={`text-pv-muted ${refreshing ? "animate-spin" : ""}`}
                      aria-hidden
                    />
                    {refreshing ? "Refreshing" : "Refresh"}
                  </button>
                  <Link
                    href="/arena/create"
                    className="flex h-11 min-h-[44px] w-full shrink-0 items-center justify-center gap-2 rounded border border-pv-emerald/30 bg-pv-emerald/[0.08] px-5 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-pv-emerald transition-colors hover:border-pv-emerald/50 hover:bg-pv-emerald/[0.14] lg:w-auto"
                  >
                    <Plus size={16} aria-hidden />
                    PUBLISH
                  </Link>
                </div>
              </div>

              <motion.div
                initial={false}
                animate={{
                  height: advancedOpen ? "auto" : 0,
                  opacity: advancedOpen ? 1 : 0,
                }}
                transition={{
                  height: { duration: 0.34, ease: [0.25, 0.46, 0.45, 0.94] },
                  opacity: { duration: 0.22, ease: [0.25, 0.1, 0.25, 1] },
                }}
                className={`overflow-hidden ${!advancedOpen ? "pointer-events-none" : ""}`}
                aria-hidden={!advancedOpen}
              >
                <div className="mt-6 border-t border-pv-border/[0.06] pt-6">
                  <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 sm:items-start sm:gap-x-10 sm:gap-y-6">
                    <div className="min-w-0">
                      <span className="mb-3 block font-display text-[10px] font-bold uppercase tracking-[0.22em] text-pv-muted">
                        CATEGORIES
                      </span>
                      <div
                        className="flex flex-wrap gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        role="group"
                        aria-label="Category"
                      >
                        <button
                          type="button"
                          aria-pressed={cat === "all"}
                          onClick={() => setCat("all")}
                          className={`${filterPillBase} ${
                            cat === "all" ? filterPillActive : filterPillInactive
                          }`}
                        >
                          ALL
                        </button>
                        {categories.map((id) => (
                          <button
                            key={id}
                            type="button"
                            aria-pressed={cat === id}
                            onClick={() => setCat(id)}
                            className={`${filterPillBase} ${
                              cat === id ? filterPillActive : filterPillInactive
                            }`}
                          >
                            {id.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <span className="mb-3 block font-display text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                        Quick minimum
                      </span>
                      <div className="flex flex-wrap gap-2" role="group">
                        {MIN_STAKE_OPTIONS.map((value) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={minStake === value}
                            onClick={() => {
                              setMinStake(value);
                              setMinDraft(value === 0 ? "" : String(value));
                            }}
                            className={`${filterPillBase} ${
                              minStake === value
                                ? filterPillActive
                                : filterPillInactive
                            }`}
                          >
                            {value === 0 ? "Any" : `${value}+ USDC`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>
      </AnimatedItem>

      <AnimatedItem className="relative z-0">
        <section id="arena-content">
          <AnimatePresence mode="wait" initial={false}>
            {activeView === "open" && (
              <motion.div
                key="arena-open-view"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22 }}
              >
                {renderGrid(openChallenges)}
              </motion.div>
            )}
            {activeView === "resolved" && (
              <motion.div
                key="arena-resolved-view"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22 }}
              >
                {renderGrid(resolvedChallenges, { isResolvedView: true })}
              </motion.div>
            )}
            {activeView === "live" && (
              <motion.div
                key="arena-live-view"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22 }}
              >
                {renderGrid(liveChallenges)}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </AnimatedItem>
    </PageTransition>
  );
}
