/**
 * GET /api/arena/claims — Solana claim feed for the /arena pages.
 *
 * Serves from the Neon read-index when DATABASE_URL is set (one SQL query,
 * kept fresh by the indexer worker). Falls back to reading every claim from
 * chain — the ER for delegated claims, the base layer otherwise — when the
 * index is unavailable, so the product still works database-free.
 *
 * Optional query params: ?state=open|active|resolved&category=crypto
 */
import { NextRequest, NextResponse } from "next/server";
import { Keypair } from "@solana/web3.js";
import { MimirSolanaClient } from "@/lib/solana/client";
import {
  isIndexEnabled,
  readClaims,
  readStats,
  type SolanaClaimRow,
} from "@/lib/server/solana-index";
import { cachedFor } from "@/lib/server/ttl-cache";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const STATE_MAP: Record<string, number[]> = {
  open: [0],
  active: [1],
  live: [0, 1],
  resolved: [2],
  cancelled: [3],
};

// Read-only chain client (throwaway keypair) for the fallback path.
let reader: MimirSolanaClient | null = null;
function getReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

type ApiClaim = ReturnType<typeof rowToApi>;

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
    claims.push({
      id: Number(claim.id),
      creator: claim.creator.toBase58(),
      question: claim.question,
      creatorPosition: claim.creatorPosition,
      counterPosition: claim.counterPosition,
      resolutionUrl: claim.resolutionUrl,
      category: claim.category,
      creatorStake: claim.creatorStake.toString(),
      totalChallengerStake: claim.totalChallengerStake.toString(),
      deadline: claim.deadline,
      state: claim.state,
      winnerSide: claim.winnerSide,
      resolutionSummary: claim.resolutionSummary,
      confidence: claim.confidence,
      createdAt: claim.createdAt,
      maxChallengers: claim.maxChallengers,
      delegated,
      challengers: claim.challengers.map((c) => ({
        addr: c.addr.toBase58(),
        stake: c.stake.toString(),
        paid: c.paid,
      })),
    });
  }
  return {
    claims: claims.reverse(),
    claimCount: Number(cfg.claimCount),
    totalResolved: Number(cfg.totalResolved),
  };
}, 4_000);

function rowToApi(c: SolanaClaimRow) {
  return {
    id: c.id,
    creator: c.creator,
    question: c.question,
    creatorPosition: c.creator_position,
    counterPosition: c.counter_position,
    resolutionUrl: c.resolution_url,
    category: c.category,
    creatorStake: c.creator_stake,
    totalChallengerStake: c.total_challenger_stake,
    deadline: c.deadline,
    state: c.state,
    winnerSide: c.winner_side,
    resolutionSummary: c.resolution_summary,
    confidence: c.confidence,
    createdAt: c.created_at,
    maxChallengers: c.max_challengers,
    delegated: c.delegated,
    challengers: c.challengers,
  };
}

export async function GET(req: NextRequest) {
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
      });
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
    return NextResponse.json({
      success: true,
      source: "chain",
      data: {
        claims,
        claimCount: scan.claimCount,
        totalResolved: scan.totalResolved,
        openPool: "0",
      },
    });
  } catch (error: any) {
    console.error("[api/arena/claims] failed:", error);
    return NextResponse.json(
      { success: false, error: error?.message ?? "arena read failed" },
      { status: 500 }
    );
  }
}
