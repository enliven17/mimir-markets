/**
 * GET /api/wallet-relay?op=…: the page that sent a deeplink request collects the wallet's answer here
 * (lib/server/wallet-relay.ts): 200 with the params once, 204 while it has not arrived.
 */
import { NextResponse } from "next/server";

import { isOp, takeRelay } from "@/lib/server/wallet-relay";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // A page polls about once a second while it waits.
  if (!(await allowRequest("wallet-relay", clientIp(req), 240, 60_000))) return tooManyRequests(10);
  const op = new URL(req.url).searchParams.get("op");
  if (!isOp(op)) return NextResponse.json({ error: "bad op" }, { status: 400 });
  const params = await takeRelay(op);
  if (!params) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  return NextResponse.json({ params }, { headers: { "cache-control": "no-store" } });
}
