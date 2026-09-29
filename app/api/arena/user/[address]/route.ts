/**
 * GET /api/arena/user/<base58>   every claim a wallet created or challenged
 *
 * Same claim shape as /api/arena/claims. Read index first, one cached chain
 * scan without it. Rate-limited per IP (tighter on the chain path).
 */
import { NextResponse } from "next/server";

import { normalizeAddress } from "@/lib/agents/signature";
import { isDbEnabled } from "@/lib/server/db";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { readUserClaims } from "@/lib/server/user-claims";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const address = normalizeAddress((await params).address);
  if (!address) {
    return NextResponse.json(
      { success: false, error: { code: "invalid_parameter", message: "address must be a Solana wallet address" } },
      { status: 400 },
    );
  }
  const limit = isDbEnabled() ? 60 : 12;
  if (!(await allowRequest("arena-user", clientIp(req), limit, 60_000))) return tooManyRequests(60);
  try {
    const data = await readUserClaims(address);
    return NextResponse.json(
      { success: true, source: data.source, data: { claims: data.claims, count: data.claims.length, indexedAt: data.indexedAt } },
      { headers: { "cache-control": "private, max-age=5" } },
    );
  } catch (err) {
    console.error("[api/arena/user] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: { code: "internal_error", message: "Unable to load positions" } }, { status: 500 });
  }
}
