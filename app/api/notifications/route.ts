/**
 * GET /api/notifications?address=<base58>   a wallet's latest notifications
 *
 * Public on purpose, as in the source: every event here (a challenge, a
 * proposal, a settlement, a claimable payout) is derived from public on-chain
 * state; this is a feed of it, not new information. Rate-limited per IP.
 */
import { NextResponse } from "next/server";

import { normalizeAddress } from "@/lib/agents/signature";
import { listNotifications } from "@/lib/server/notifications";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const address = normalizeAddress(new URL(req.url).searchParams.get("address"));
  if (!address) return NextResponse.json({ error: "address must be a Solana wallet address" }, { status: 400 });
  if (!(await allowRequest("notifications", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const items = await listNotifications(address).catch(() => []);
  return NextResponse.json({ items }, { headers: { "cache-control": "private, max-age=20" } });
}
