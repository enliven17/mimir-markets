"use client";

/**
 * Every claim the wallet created or challenged, from /api/arena/user/<address>.
 * The last good list survives a failed refresh; `error` says it is stale.
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

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    if (!address) {
      setState({ claims: [], loaded: false, refreshing: false, error: false, indexedAt: 0 });
      return;
    }
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const res = await fetch(`/api/arena/user/${encodeURIComponent(address)}`);
      const json = await res.json();
      if (id !== requestId.current) return;
      if (!res.ok || !json.success) throw new Error("positions request failed");
      setState({ claims: json.data.claims as ApiClaim[], loaded: true, refreshing: false, error: false, indexedAt: Number(json.data.indexedAt ?? 0) });
    } catch {
      if (id !== requestId.current) return;
      setState((s) => ({ ...s, loaded: true, refreshing: false, error: true }));
    }
  }, [address]);

  useEffect(() => {
    setState({ claims: [], loaded: false, refreshing: false, error: false, indexedAt: 0 });
    void reload();
    if (!address) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [address, reload]);

  return { ...state, reload };
}
