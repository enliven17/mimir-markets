/**
 * GET /api/arena/[id]: one claim with its V3 lifecycle fields, for the claim
 * page. From the read index when available (never capped to the newest rows
 * like the feed), else straight from chain.
 */
import { NextResponse } from "next/server";
import { Keypair } from "@solana/web3.js";
import { MimirSolanaClient } from "@/lib/solana/client";
import { isIndexEnabled, readClaim } from "@/lib/server/solana-index";
import { claimToApi, rowToApi, type ApiClaim } from "@/lib/server/arena-claim";
import { cachedFor } from "@/lib/server/ttl-cache";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

let reader: MimirSolanaClient | null = null;
function getReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

const fromChain = cachedFor(async (id: number): Promise<ApiClaim | null> => {
  const client = getReader();
  const [claim, delegated] = await Promise.all([client.getClaim(BigInt(id)), client.isDelegated(BigInt(id))]);
  return claim ? claimToApi(claim, delegated) : null;
}, 3_000);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claimId = Number(id);
  if (!Number.isInteger(claimId) || claimId <= 0) {
    return NextResponse.json({ success: false, error: "invalid claim id" }, { status: 400 });
  }
  try {
    let claim: ApiClaim | null = null;
    if (isIndexEnabled()) {
      const row = await readClaim(claimId);
      claim = row ? rowToApi(row) : null;
    }
    if (!claim) {
      // Chain read: two RPC calls per request, so it is rate-limited.
      if (!(await allowRequest("arena-claim-read", clientIp(req), 60, 60_000))) {
        return tooManyRequests(60);
      }
      claim = await fromChain(claimId);
    }
    if (!claim) return NextResponse.json({ success: false, error: "claim not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: claim });
  } catch (error) {
    console.error("[api/arena/[id]] failed:", error);
    return NextResponse.json({ success: false, error: "claim read failed" }, { status: 500 });
  }
}
