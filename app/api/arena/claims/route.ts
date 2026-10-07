/**
 * GET /api/arena/claims: Solana claim feed for the /arena pages.
 *
 * Serves from the Neon read-index when DATABASE_URL is set (one SQL query,
 * kept fresh by the indexer worker). Falls back to reading every claim from
 * chain (the ER for delegated claims, the base layer otherwise) when the
 * index is unavailable, so the product still works database-free.
 *
 * Optional query params:
 *   ?state=open|active|live|proposed|disputed|settling|resolved|cancelled
 *   &category=crypto
 * Every claim carries its V3 lifecycle fields (proposal, dispute window,
 * bond, frozen fee terms) so pages can render PROPOSED / DISPUTED claims.
 */
import { NextRequest, NextResponse } from "next/server";
import { oldCliGone } from "@/lib/server/public-markets";
import { Keypair } from "@solana/web3.js";
import { MimirSolanaClient } from "@/lib/solana/client";
import { isIndexEnabled, readClaims, readStats } from "@/lib/server/solana-index";
import { claimToApi, rowToApi, type ApiClaim } from "@/lib/server/arena-claim";
import { cachedFor } from "@/lib/server/ttl-cache";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { holdsStakes } from "@/lib/claim-status";

export const dynamic = "force-dynamic";

/**
 * Shared-cache window: every viewer polls this every few seconds, so the CDN
 * answers from a copy at most a couple of seconds old and refreshes it in the
 * background, instead of each poll paying a cold function and a database or
 * RPC round trip. Browsers always revalidate (max-age=0).
 */
const INDEX_CACHE = "public, max-age=0, s-maxage=2, stale-while-revalidate=30";
const CHAIN_CACHE = "public, max-age=0, s-maxage=4, stale-while-revalidate=30";

const STATE_MAP: Record<string, number[]> = {
  open: [0],
  active: [1],
  live: [0, 1],
  proposed: [4],
  disputed: [5],
  /** A verdict is in but not final. */
  settling: [4, 5],
  resolved: [2],
  cancelled: [3],
};

// Read-only chain client (throwaway keypair) for the fallback path.
let reader: MimirSolanaClient | null = null;
function getReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

/**
 * Every claim read straight from chain, newest first. Cached per instance for
 * a poll interval, so concurrent viewers (and every state/category filter)
 * share one scan instead of each paying one RPC round-trip per claim.
 */
const scanChain = cachedFor(async (): Promise<{
  claims: ApiClaim[];
  claimCount: number;
  totalResolved: number;
}> => {
  const client = getReader();
  const cfg = await client.getConfig();
  if (!cfg) return { claims: [], claimCount: 0, totalResolved: 0 };
  const claims: ApiClaim[] = [];
  for (let id = 1n; id <= cfg.claimCount; id++) {
    const [claim, delegated] = await Promise.all([
      client.getClaim(id),
      client.isDelegated(id),
    ]);
    if (!claim) continue;
    claims.push(claimToApi(claim, delegated));
  }
  return {
    claims: claims.reverse(),
    claimCount: Number(cfg.claimCount),
    totalResolved: Number(cfg.totalResolved),
  };
}, 4_000);

export async function GET(req: NextRequest) {
  const gone = oldCliGone(req);
  if (gone) return gone;
  try {
    const sp = req.nextUrl.searchParams;
    const stateParam = sp.get("state");
    const category = sp.get("category") ?? undefined;
    const states = stateParam ? STATE_MAP[stateParam.toLowerCase()] : undefined;

    // ── Fast path: Neon read-index ───────────────────────────────────────
    if (isIndexEnabled()) {
      const [rows, stats] = await Promise.all([
        readClaims({ states, category }),
        readStats(),
      ]);
      return NextResponse.json({
        success: true,
        source: "index",
        data: {
          claims: rows.map(rowToApi),
          claimCount: stats.claimCount,
          totalResolved: stats.totalResolved,
          openPool: stats.openPool,
        },
      }, { headers: { "Cache-Control": INDEX_CACHE } });
    }

    // ── Fallback: read directly from chain ───────────────────────────────
    // One RPC read per claim: the feed polls every 4s (15/min per tab), so
    // this leaves room for two tabs while capping a scripted scan.
    if (!(await allowRequest("arena-claims-scan", clientIp(req), 30, 60_000))) {
      return tooManyRequests(60);
    }
    const scan = await scanChain();
    const claims = scan.claims.filter(
      (c) => (!states || states.includes(c.state)) && (!category || c.category === category)
    );
    const openPool = scan.claims
      .filter((c) => holdsStakes(c.state))
      .reduce((sum, c) => sum + BigInt(c.creatorStake) + BigInt(c.totalChallengerStake), 0n);
    return NextResponse.json({
      success: true,
      source: "chain",
      data: {
        claims,
        claimCount: scan.claimCount,
        totalResolved: scan.totalResolved,
        openPool: openPool.toString(),
      },
    }, { headers: { "Cache-Control": CHAIN_CACHE } });
  } catch (error: any) {
    console.error("[api/arena/claims] failed:", error);
    return NextResponse.json(
      { success: false, error: "arena read failed" },
      { status: 500 }
    );
  }
}
