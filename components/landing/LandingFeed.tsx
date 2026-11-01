"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { requestRefresh } from "@/lib/motion";
import type { LandingFeed } from "@/lib/landing";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { arcArenaEnabled } from "@/components/arc/arena/enabled";
import { arcLandingFeed } from "@/lib/arc/landing";

/**
 * One arena feed for every landing section, live from the Convex index of Arc markets. Sections render their own
 * loading, empty and offline states from `status`; nothing here invents a value.
 */
export type FeedStatus = "loading" | "ready" | "error";

interface FeedState {
  feed: LandingFeed | null;
  status: FeedStatus;
}

const FeedContext = createContext<FeedState>({ feed: null, status: "loading" });

export function useLandingFeed(): FeedState {
  return useContext(FeedContext);
}

/**
 * Re-measure every scroll trigger once the layout has settled. Sections that
 * change height when data lands (the inspector, the ledger) would otherwise
 * leave the pinned and scrubbed triggers below them measured against the
 * loading layout. Coalesced to one refresh per frame (lib/motion).
 */
export function requestScrollRefresh(): void {
  requestRefresh();
}

/** Arc: the same feed from the live Convex index; no polling, Convex pushes changes. */
function ArcLandingFeedProvider({ children }: { children: ReactNode }) {
  const markets = useQuery(api.arc.markets, { limit: 500 });
  const loaded = useRef(false);
  useEffect(() => {
    if (markets && !loaded.current) {
      loaded.current = true;
      requestScrollRefresh();
    }
  }, [markets]);
  const state = useMemo<FeedState>(() => (markets ? { feed: arcLandingFeed(markets), status: "ready" } : { feed: null, status: "loading" }), [markets]);
  return <FeedContext.Provider value={state}>{children}</FeedContext.Provider>;
}

const OFFLINE: FeedState = { feed: null, status: "error" };

/** Without the Arc contracts and Convex configured there is no feed: the sections show their offline state. */
export default function LandingFeedProvider({ children }: { children: ReactNode }) {
  return arcArenaEnabled ? <ArcLandingFeedProvider>{children}</ArcLandingFeedProvider> : <FeedContext.Provider value={OFFLINE}>{children}</FeedContext.Provider>;
}
