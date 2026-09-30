"use client";

/**
 * Every claim the wallet created or challenged, from /api/arena/user/<address>.
 * The last good list survives a failed refresh; `error` says it is stale.
 * Background polls skip hidden tabs, never flip `refreshing`, and keep the
 * previous state when the answer did not change, so nothing re-renders.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiClaim } from "@/lib/server/arena-claim";

export interface UserPositionsState {
  claims: ApiClaim[];
  /** False until the first answer (success or failure) for this address. */
  loaded: boolean;
  refreshing: boolean;
  error: boolean;
  /** Unix seconds of the freshest index write, 0 when read from chain. */
  indexedAt: number;
}

const POLL_MS = 30_000;

export function useUserPositions(address: string | null) {
  const [state, setState] = useState<UserPositionsState>({ claims: [], loaded: false, refreshing: false, error: false, indexedAt: 0 });
  const requestId = useRef(0);

  const lastBody = useRef("");

  const load = useCallback(
    async (silent: boolean) => {
      const id = ++requestId.current;
      if (!address) {
        setState({ claims: [], loaded: false, refreshing: false, error: false, indexedAt: 0 });
        return;
      }
      if (!silent) setState((s) => ({ ...s, refreshing: true }));
      try {
        const res = await fetch(`/api/arena/user/${encodeURIComponent(address)}`);
        const text = await res.text();
        if (id !== requestId.current) return;
        const json = JSON.parse(text);
        if (!res.ok || !json.success) throw new Error("positions request failed");
        const unchanged = text === lastBody.current;
        lastBody.current = text;
        setState((s) =>
          unchanged && s.loaded && !s.error && !s.refreshing
            ? s
            : { claims: unchanged ? s.claims : (json.data.claims as ApiClaim[]), loaded: true, refreshing: false, error: false, indexedAt: Number(json.data.indexedAt ?? 0) },
        );
      } catch {
        if (id !== requestId.current) return;
        setState((s) => (s.loaded && s.error && !s.refreshing ? s : { ...s, loaded: true, refreshing: false, error: true }));
      }
    },
    [address],
  );
  const reload = useCallback(() => load(false), [load]);

  useEffect(() => {
    setState({ claims: [], loaded: false, refreshing: false, error: false, indexedAt: 0 });
    lastBody.current = "";
    void load(true);
    if (!address) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [address, load]);

  return { ...state, reload };
}
