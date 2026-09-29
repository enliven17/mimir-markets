"use client";

/**
 * Token tiers for a set of wallets (a claim's creator and challengers), for
 * holder badges. One batched /api/token/tier?wallets= request per new set,
 * and a page-lifetime cache so the claim page's 4s refresh re-requests
 * nothing: tiers move slowly and the badge is decoration.
 */
import { useEffect, useMemo, useState } from "react";
import type { TokenTier } from "@/lib/token-tiers";

const MAX_BATCH = 17;
const known = new Map<string, TokenTier>();
const pending = new Set<string>();

async function loadTiers(wallets: string[]): Promise<void> {
  const res = await fetch(`/api/token/tier?wallets=${wallets.map(encodeURIComponent).join(",")}`);
  if (!res.ok) return;
  const body = (await res.json().catch(() => null)) as { data?: { tiers?: Record<string, TokenTier> } } | null;
  for (const [w, tier] of Object.entries(body?.data?.tiers ?? {})) known.set(w, tier);
}

export function useWalletTiers(wallets: readonly string[]): Record<string, TokenTier> {
  const key = useMemo(() => [...new Set(wallets.filter(Boolean))].sort().join(","), [wallets]);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!key) return;
    const missing = key.split(",").filter((w) => !known.has(w) && !pending.has(w)).slice(0, MAX_BATCH);
    if (missing.length === 0) return;
    let live = true;
    missing.forEach((w) => pending.add(w));
    loadTiers(missing)
      .catch(() => {})
      .finally(() => {
        // A wallet that failed stays unknown for this page load: no retry storm.
        missing.forEach((w) => {
          pending.delete(w);
          if (!known.has(w)) known.set(w, "none");
        });
        if (live) setVersion((v) => v + 1);
      });
    return () => {
      live = false;
    };
  }, [key]);

  const out: Record<string, TokenTier> = {};
  for (const w of key ? key.split(",") : []) {
    const tier = known.get(w);
    if (tier) out[w] = tier;
  }
  return out;
}
