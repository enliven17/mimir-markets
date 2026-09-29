/**
 * GET /api/arena/[id]/council — where each council persona stands on one
 * claim. Solana port of the original /api/vs/[id]/council: matches the council
 * roster against the claim's on-chain challenger list.
 */
import { NextResponse } from "next/server";
import { Keypair } from "@solana/web3.js";
import { MimirSolanaClient } from "@/lib/solana/client";
import { councilRoster } from "@/lib/server/council-roster";
import { isIndexEnabled, readClaim } from "@/lib/server/solana-index";
import { cachedFor } from "@/lib/server/ttl-cache";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

type Challenger = { addr: string; stake: string; paid: boolean };

let reader: MimirSolanaClient | null = null;
function getReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

/**
 * The claim's challengers, from the index when available else from chain;
 * null when the claim can't be found. Cached per instance for 20s so a burst
 * of views (or random ids from a scraper) costs one lookup per claim.
 */
const challengersFor = cachedFor(async (claimId: number): Promise<Challenger[] | null> => {
  if (isIndexEnabled()) {
    const row = await readClaim(claimId);
    if (row) return row.challengers;
  }
  const claim = await getReader().getClaim(BigInt(claimId));
  if (!claim) return null;
  return claim.challengers.map((c) => ({
    addr: c.addr.toBase58(),
    stake: c.stake.toString(),
    paid: c.paid,
  }));
}, 20_000);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await allowRequest("arena-council", clientIp(req), 30, 60_000))) {
    return tooManyRequests(60);
  }
  const { id } = await params;
  const claimId = Number(id);
  if (!Number.isInteger(claimId) || claimId <= 0) {
    return NextResponse.json({ success: false, error: "invalid claim id" }, { status: 400 });
  }

  let challengers: Challenger[] | null;
  try {
    challengers = await challengersFor(claimId);
  } catch (error) {
    // A read failure is not "no persona staked": say so, and keep it uncached.
    console.error("[api/arena/[id]/council] read failed:", error);
    return NextResponse.json(
      { success: false, error: "chain read failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!challengers) {
    // getClaim swallows RPC errors as "not found", so this may be transient.
    return NextResponse.json(
      { success: false, error: "claim not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const roster = councilRoster();
  const byAddr = new Map(challengers.map((c) => [c.addr, c]));
  const votes = roster.map((p) => {
    const ch = p.address ? byAddr.get(p.address) : undefined;
    return {
      slug: p.slug,
      displayName: p.displayName,
      emoji: p.emoji,
      archetype: p.archetype,
      track: p.track,
      address: p.address,
      staked: Boolean(ch),
      stakeUsdc: ch ? Number(ch.stake) / 1e6 : 0,
      paid: ch?.paid ?? false,
    };
  });

  const stakedCount = votes.filter((v) => v.staked).length;
  const totalUsdc = votes.reduce((s, v) => s + v.stakeUsdc, 0);

  return NextResponse.json({
    claimId,
    total: roster.length,
    stakedCount,
    totalUsdc,
    votes,
  });
}
