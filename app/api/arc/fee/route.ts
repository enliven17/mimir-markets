/**
 * GET /api/arc/fee  →  { bps }
 *
 * Circle's current Fast Transfer fee for Solana → Arc, in basis points (it
 * can be fractional). The deposit sets `maxFee` from it plus headroom
 * (lib/arc/iris.ts `fastMaxFee`). Cached briefly: it rarely moves.
 */
import { NextResponse } from "next/server";

import { ARC } from "@/lib/arc/config";
import { irisFeesUrl, parseFastFeeBps } from "@/lib/arc/iris";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await allowRequest("arc-fee", clientIp(req), 30, 60_000))) return tooManyRequests(60);
  try {
    const res = await fetch(irisFeesUrl(ARC.cctp.irisUrl, ARC.cctp.domains.solana, ARC.cctp.domains.arc), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const bps = res.ok ? parseFastFeeBps(await res.json()) : null;
    if (bps === null) return NextResponse.json({ error: "the fee quote is not available" }, { status: 502 });
    return NextResponse.json({ bps }, { headers: { "cache-control": "s-maxage=30, stale-while-revalidate=60" } });
  } catch (err) {
    console.warn("[arc-fee] Iris unreachable:", err);
    return NextResponse.json({ error: "the attestation service is not reachable" }, { status: 502 });
  }
}
