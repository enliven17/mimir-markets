"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { requestRefresh } from "@/lib/motion";
import type { LandingFeed } from "@/lib/landing";
import { cachedBody, cachedJson, fetchBody } from "@/lib/json-cache";

const FEED_URL = "/api/arena/claims";

/**
 * One arena feed for every landing section: fetched once on mount, then
 * polled while the tab is visible. Sections render their own loading, empty
 * and offline states from `status`; nothing here invents a value.
 */
export type FeedStatus = "loading" | "ready" | "error";

interface FeedState {
  feed: LandingFeed | null;
  status: FeedStatus;
}

const POLL_MS = 15_000;

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

export default function LandingFeedProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FeedState>(() => {
    const json = cachedJson<{ success?: boolean; data?: LandingFeed }>(FEED_URL);
    return json?.success && json.data ? { feed: json.data, status: "ready" } : { feed: null, status: "loading" };
  });
  const loaded = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const controller = new AbortController();

    // An unchanged poll must not re-render every section mid-scroll.
    let lastBody = cachedBody(FEED_URL) ?? "";
    const load = async () => {
      try {
        const { body } = await fetchBody(FEED_URL, { signal: controller.signal });
        if (!alive) return;
        if (body === lastBody && loaded.current) return;
        lastBody = body;
        const json = JSON.parse(body) as { success?: boolean; data?: LandingFeed };
        if (json.success && json.data) {
          setState({ feed: json.data, status: "ready" });
          if (!loaded.current) {
            loaded.current = true;
            requestScrollRefresh();
          }
        } else {
          // Keep the last good feed; only report offline when there is none.
          setState((s) => (s.feed ? s : { feed: null, status: "error" }));
        }
      } catch {
        if (alive && !controller.signal.aborted) setState((s) => (s.feed ? s : { feed: null, status: "error" }));
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (!document.hidden) await load();
        if (alive) schedule();
      }, POLL_MS);
    };

    void load().then(() => alive && schedule());
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  return <FeedContext.Provider value={state}>{children}</FeedContext.Provider>;
}
