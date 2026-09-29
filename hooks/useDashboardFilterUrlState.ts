"use client";

/**
 * Dashboard filters mirrored into the query string (`?tab=&cat=&min=&q=`)
 * with `history.replaceState`, so a filtered view can be shared or reloaded
 * without `router.replace` re-fetching the page. Back/forward re-reads them.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { CATEGORIES } from "@/lib/constants";
import {
  DEFAULT_DASHBOARD_FILTERS,
  parseDashboardFilters,
  serializeDashboardFilters,
  type DashboardFilters,
} from "@/lib/dashboard-positions";

const CATEGORY_IDS = CATEGORIES.map((c) => c.id as string);
const parse = (qs: string) => parseDashboardFilters(new URLSearchParams(qs), CATEGORY_IDS);

export function useDashboardFilterUrlState() {
  const searchParams = useSearchParams();
  const signature = searchParams.toString();
  const [filters, setFilters] = useState<DashboardFilters>(() => parse(signature));

  useEffect(() => setFilters(parse(signature)), [signature]);

  useEffect(() => {
    const onPop = () => setFilters(parse(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = useCallback((patch: Partial<DashboardFilters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      const qs = serializeDashboardFilters(next);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      return next;
    });
  }, []);

  const reset = useCallback(() => update(DEFAULT_DASHBOARD_FILTERS), [update]);

  return { filters, update, reset };
}
