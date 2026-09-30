"use client";

/**
 * /arena: the claim feed. One header line (open claims, USDC in play), one
 * control row (Open / Live / Settled, search, a Filters popover with
 * category, minimum stake and sort), the card grid, and a collapsed rail of
 * suggested claims at the bottom.
 *
 * Polls GET /api/arena/claims every 4s; pools roll to new values as stakes
 * land. Claims delegated to the MagicBlock Ephemeral Rollup sit under "Live".
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import RollingNumber from "@/components/motion/RollingNumber";
import { ArenaCardSkeleton } from "@/components/ui/Skeleton";
import ClaimCard, { type SolanaClaim } from "@/components/arena/ClaimCard";
import ArenaControls from "@/components/arena/feed/ArenaControls";
import ChallengeOpportunities from "@/components/arena/ChallengeOpportunities";
import { OnboardingBanner } from "@/components/onboarding/OnboardingChecklist";
import ExploreArenaEmptyState from "@/components/explorer/ExploreArenaEmptyState";
import ExploreFilteredEmptyState from "@/components/explorer/ExploreFilteredEmptyState";
import { useNowSec } from "@/components/arena/settlement/useSettleAction";
import {
  ARENA_VIEWS,
  DEFAULT_FILTERS,
  feedCategories,
  feedTotals,
  hasNarrowing,
  viewClaims,
  type ArenaFilters,
  type ArenaView,
} from "@/lib/arena-feed";
import { formatUsdcBare } from "@/lib/money";

const POLL_MS = 4000;
const count = (n: number) => Math.round(n).toString();
const money = (n: number) => `$${formatUsdcBare(n)}`;

/**
 * Keep the previous object for every claim whose data did not change, and the
 * previous array when nothing changed at all, so a poll re-renders only the
 * cards that moved (ClaimCard is memoized).
 */
function patchClaims(prev: SolanaClaim[] | null, next: SolanaClaim[]): SolanaClaim[] {
  if (!prev) return next;
  const byId = new Map(prev.map((c) => [c.id, c]));
  let changed = prev.length !== next.length;
  const out = next.map((c, i) => {
    const old = byId.get(c.id);
    if (old && JSON.stringify(old) === JSON.stringify(c)) {
      if (prev[i] !== old) changed = true;
      return old;
    }
    changed = true;
    return c;
  });
  return changed ? out : prev;
}

const EMPTY_HREF: Record<ArenaView, string> = {
  open: "/arena/create",
  live: "/arena",
  resolved: "/docs",
};

export default function ArenaPage() {
  const t = useTranslations("arena.feed");
  const [claims, setClaims] = useState<SolanaClaim[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<ArenaView>("open");
  const [filters, setFilters] = useState<ArenaFilters>(DEFAULT_FILTERS);
  const [, startTransition] = useTransition();
  const alive = useRef(true);
  // View membership and phases move on a coarse clock; card countdowns tick on their own.
  const now = useNowSec(30_000);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/arena/claims", { cache: "no-store" });
      const json = await res.json();
      if (!alive.current) return;
      if (json.success) {
        setClaims((prev) => patchClaims(prev, json.data.claims as SolanaClaim[]));
        setFailed(false);
      } else setFailed(true);
    } catch (error) {
      console.error("Failed to load arena claims:", error);
      // Keep the last good list.
      if (alive.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [load]);

  const list = claims ?? [];
  const categories = useMemo(() => feedCategories(list), [list]);
  const totals = useMemo(() => feedTotals(list, now), [list, now]);
  const byView = useMemo(
    () =>
      Object.fromEntries(ARENA_VIEWS.map((v) => [v, viewClaims(list, v, filters, now)])) as Record<ArenaView, SolanaClaim[]>,
    [list, filters, now],
  );
  const counts = useMemo(
    () => Object.fromEntries(ARENA_VIEWS.map((v) => [v, byView[v].length])) as Record<ArenaView, number>,
    [byView],
  );
  const shown = byView[view];

  const reset = () => setFilters(DEFAULT_FILTERS);

  let body: React.ReactNode;
  if (claims === null) {
    body = failed ? (
      <ExploreFilteredEmptyState message={t("offline")} resetLabel={t("retry")} onReset={() => void load()} />
    ) : (
      <div role="status" aria-label={t("loading")} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ArenaCardSkeleton />
        <ArenaCardSkeleton />
        <ArenaCardSkeleton />
      </div>
    );
  } else if (shown.length === 0) {
    body = hasNarrowing(filters) ? (
      <ExploreFilteredEmptyState message={t("empty.filtered")} resetLabel={t("emptyCta.filtered")} onReset={reset} />
    ) : view === "live" ? (
      <ExploreFilteredEmptyState message={t("empty.live")} resetLabel={t("emptyCta.live")} onReset={() => setView("open")} />
    ) : (
      <ExploreArenaEmptyState message={t(`empty.${view}`)} ctaLabel={t(`emptyCta.${view}`)} ctaHref={EMPTY_HREF[view]} />
    );
  } else {
    body = (
      <div key={view} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((claim, i) => (
          <ClaimCard key={claim.id} claim={claim} now={now} index={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
        <p className="m-0 flex items-center gap-2 text-[14px] text-muted" aria-live="off">
          <span aria-hidden className="live-dot !h-1.5 !w-1.5" />
          {claims === null ? (
            // Not "0 open": the count is unknown until the first answer.
            <span className="text-cream">—</span>
          ) : (
            <RollingNumber value={totals.open} format={count} className="text-cream" />
          )}
          <span>{t("statusOpen")}</span>
          <span aria-hidden>·</span>
          {claims === null ? (
            <span className="text-cream">—</span>
          ) : (
            <RollingNumber value={totals.inPlay} format={money} flash className="text-cream" />
          )}
          <span>{t("statusInPlay")}</span>
        </p>
      </header>

      <OnboardingBanner />

      <section aria-label={t("viewsLabel")} className="grid gap-5">
        <ArenaControls
          view={view}
          onView={(v) => startTransition(() => setView(v))}
          counts={claims === null ? null : counts}
          filters={filters}
          onFilters={setFilters}
          categories={categories}
          resultCount={shown.length}
        />
        <div id="arena-content">{body}</div>
      </section>

      <ChallengeOpportunities />
    </div>
  );
}
