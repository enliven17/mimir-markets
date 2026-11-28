/**
 * GET /api/markets/[kind]/[id]?chain=bsc|base|arc: one market (vs or pool) with its positions, the oracle's verdict and its
 * linked markets on other chains, public and read-only. `chain` defaults to arc (links from before Base). Rate-limited per IP.
 * The verdict carries the committed evidenceHash and the audit bundle it seals, so anyone (agents/sentinel) can re-verify
 * the Proof of Reasoning.
 */
import { NextResponse } from "next/server";

import { arcMarketDetail } from "@/lib/server/arc-index";
import { toPublic, usdc, type IndexedMarket } from "@/lib/server/public-markets";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  if (!(await allowRequest("markets", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const { kind, id } = await params;
  const marketId = Number(id);
  const chain = new URL(req.url).searchParams.get("chain") ?? "arc";
  if (chain !== "arc" && chain !== "base" && chain !== "bsc") return NextResponse.json({ success: false, error: "chain must be bsc, base or arc" }, { status: 400 });
  if ((kind !== "vs" && kind !== "pool") || !Number.isInteger(marketId) || marketId < 0) {
    return NextResponse.json({ success: false, error: "use /api/markets/vs/<id> or /api/markets/pool/<id>" }, { status: 400 });
  }
  try {
    const m = await arcMarketDetail(kind, marketId, chain);
    if (!m) return NextResponse.json({ success: false, error: "no such market" }, { status: 404 });
    const positions = m.positions.map((p) => ({ user: p.user, side: p.side, usdc: usdc(p.amount) }));
    const v = m.verdict as (NonNullable<typeof m.verdict> & { evidenceHash?: string; bundle?: string }) | null | undefined;
    const verdict = v ? { side: v.side, confidence: v.confidence, summary: v.summary, txHash: v.txHash, evidenceHash: v.evidenceHash ?? null, bundle: v.bundle ?? null } : null;
    const linked = (m.linked ?? []).map((l) => ({ chain: l.chain, kind: l.kind, marketId: l.marketId }));
    const market = { ...toPublic(m as IndexedMarket, Math.floor(Date.now() / 1000)), positions, verdict, linked };
    return NextResponse.json({ success: true, data: { market } }, { headers: { "cache-control": "public, s-maxage=10" } });
  } catch (err) {
    console.error("[markets] read failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "the market index is unavailable" }, { status: 503 });
  }
}
