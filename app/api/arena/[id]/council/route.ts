/**
 * GET /api/arena/[id]/council — where each council persona stands on one
 * claim. Solana port of the original /api/vs/[id]/council: matches the council
 * roster against the claim's on-chain challenger list.
 */
import { NextResponse } from "next/server";
import { Keypair } from "@solana/web3.js";
import { MimirSolanaClient } from "@/lib/solana/client";
import { councilRoster } from "@/lib/server/council-roster";
import { isIndexEnabled, readClaims } from "@/lib/server/solana-index";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

let reader: MimirSolanaClient | null = null;
function getReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await allowRequest("arena-council", clientIp(req), 30, 60_000))) {
    return tooManyRequests(60);
  }
  try {
    const { id } = await params;
    const claimId = Number(id);
    const roster = councilRoster();

    // The claim's challengers, from the index when available else from chain.
    let challengers: { addr: string; stake: string; paid: boolean }[] = [];
    if (isIndexEnabled()) {
      const claims = await readClaims({ limit: 500 });
      challengers = claims.find((c) => c.id === claimId)?.challengers ?? [];
    } else {
      const claim = await getReader().getClaim(BigInt(claimId));
      challengers =
        claim?.challengers.map((c) => ({
          addr: c.addr.toBase58(),
          stake: c.stake.toString(),
          paid: c.paid,
        })) ?? [];
    }

    const byAddr = new Map(challengers.map((c) => [c.addr, c]));
    const votes = roster.map((p) => {
      const ch = p.address ? byAddr.get(p.address) : undefined;
      return {
        slug: p.slug,
        displayName: p.displayName,
        emoji: p.emoji,
        archetype: p.archetype,
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
  } catch (error: any) {
    console.error("[api/arena/[id]/council] failed:", error);
    return NextResponse.json(
      { success: false, error: error?.message ?? "council read failed" },
      { status: 500 }
    );
  }
}
