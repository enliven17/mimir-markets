/**
 * GET /api/markets?state=live|closing|settled|all&kind=vs|pool&limit=: Arc markets from the backend index, public
 * and read-only (lib/server/public-markets.ts). The CLI reads this. Rate-limited per IP.
 */
import { NextResponse } from "next/server";

import { arcMarketList } from "@/lib/server/arc-index";
import { filterMarkets, toPublic, type IndexedMarket, type MarketFilter } from "@/lib/server/public-markets";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const FILTERS = new Set<MarketFilter>(["live", "closing", "settled", "all"]);

export async function GET(req: Request) {
  if (!(await allowRequest("markets", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const sp = new URL(req.url).searchParams;
  const state = (sp.get("state") ?? "all").toLowerCase() as MarketFilter;
  const kind = sp.get("kind")?.toLowerCase();
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 100) || 100, 1), 500);
  if (!FILTERS.has(state)) return NextResponse.json({ success: false, error: "state must be live, closing, settled or all" }, { status: 400 });
  if (kind && kind !== "vs" && kind !== "pool") return NextResponse.json({ success: false, error: "kind must be vs or pool" }, { status: 400 });
  try {
    const now = Math.floor(Date.now() / 1000);
    const rows = (await arcMarketList(kind as "vs" | "pool" | undefined)) as IndexedMarket[];
    const markets = filterMarkets(rows.map((m) => toPublic(m, now)), state, now).slice(0, limit);
    return NextResponse.json({ success: true, data: { markets } }, { headers: { "cache-control": "public, s-maxage=10" } });
  } catch (err) {
    console.error("[markets] read failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "the market index is unavailable" }, { status: 503 });
  }
}
