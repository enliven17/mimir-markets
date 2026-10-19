"use client";

/**
 * An agent token's live chart. DexScreener's embed waits forever ("Loading pair…") for a token it has no pair for,
 * which is every token still on its first trades (the council's pump.fun tokens, Argus on Arc, a fresh Pons curve).
 * So the pair is looked up first, from the browser (each viewer's own rate limit):
 *   1. DexScreener  GET api.dexscreener.com/tokens/v1/{chain}/{token}       → embed the pair
 *   2. GeckoTerminal GET api.geckoterminal.com/api/v2/networks/{net}/tokens/{token}/pools → embed the pool
 *   3. neither: say so, with a link to where the token trades.
 * Chain ids are the same on both (solana, arc, robinhood), checked 2026-10-19.
 */
import { useEffect, useState } from "react";

import { ExternalMark } from "@/components/ExternalMark";
import Skeleton from "@/components/ui/Skeleton";

type Chain = "solana" | "arc" | "robinhood";
type Found = { kind: "loading" } | { kind: "embed"; src: string } | { kind: "none" };

async function findChart(chain: Chain, token: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${token}`, { signal });
    const pairs = res.ok ? ((await res.json()) as Array<{ pairAddress?: string; liquidity?: { usd?: number } }>) : [];
    const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (best?.pairAddress) return `https://dexscreener.com/${chain}/${best.pairAddress}?embed=1&theme=dark&trades=0&info=0`;
  } catch {
    if (signal.aborted) return null;
  }
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${chain}/tokens/${token}/pools?page=1`, { signal });
    const pools = res.ok ? ((await res.json()) as { data?: Array<{ attributes?: { address?: string } }> }).data ?? [] : [];
    const pool = pools[0]?.attributes?.address;
    if (pool) return `https://www.geckoterminal.com/${chain}/pools/${pool}?embed=1&info=0&swaps=0&light_chart=0`;
  } catch {
    /* no chart source answered */
  }
  return null;
}

export default function TokenChart({ chain, token, title, tradeUrl, tradeLabel }: { chain: Chain; token: string; title: string; tradeUrl: string; tradeLabel: string }) {
  const [found, setFound] = useState<Found>({ kind: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    setFound({ kind: "loading" });
    findChart(chain, token, ctrl.signal).then((src) => {
      if (!ctrl.signal.aborted) setFound(src ? { kind: "embed", src } : { kind: "none" });
    });
    return () => ctrl.abort();
  }, [chain, token]);

  if (found.kind === "loading") return <Skeleton className="h-[420px] w-full" />;
  if (found.kind === "embed") return <iframe key={found.src} title={title} src={found.src} className="block h-[420px] w-full border-0" loading="lazy" />;
  return (
    <div className="grid h-[220px] place-items-center p-6 text-center">
      <div className="grid justify-items-center gap-3">
        <p className="m-0 max-w-[46ch] text-[14px] leading-relaxed text-muted">No chart yet: the chart sites list a token once it has traded. Its price and trades are live on its launchpad.</p>
        <a href={tradeUrl} target="_blank" rel="noreferrer" className="text-[14px] text-coral hover:underline">
          {tradeLabel} <ExternalMark />
        </a>
      </div>
    </div>
  );
}
