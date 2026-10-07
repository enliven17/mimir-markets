/**
 * GET /api/terminal/token?mint=<base58>: a mainnet token's market numbers and
 * safety flags for the terminal (lib/server/token-info.ts). Rate-limited per IP.
 */
import { NextResponse } from "next/server";

import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { tokenInfo } from "@/lib/server/token-info";

/** A Solana mint address (base58, 32-44 chars). */
const isMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await allowRequest("terminal-token", clientIp(req), 30, 60_000))) return tooManyRequests(60);
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!isMint(mint)) return NextResponse.json({ success: false, error: "mint must be a Solana address" }, { status: 400 });
  const info = await tokenInfo(mint);
  if (!info) return NextResponse.json({ success: false, error: "no market found for this token" }, { status: 404 });
  return NextResponse.json({ success: true, data: info }, { headers: { "cache-control": "public, s-maxage=30" } });
}
