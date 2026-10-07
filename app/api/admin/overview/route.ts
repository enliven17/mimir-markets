/**
 * GET /api/admin/overview: everything the admin panel shows (lib/server/admin-overview.ts). Read-only. Only an
 * ADMIN_WALLETS wallet with a signed holder proof gets an answer; everyone else gets a plain 404.
 */
import { NextResponse } from "next/server";

import { adminWallet } from "@/lib/server/admin";
import { adminOverview } from "@/lib/server/admin-overview";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

export async function GET(req: Request) {
  if (!(await allowRequest("admin", clientIp(req), 20, 60_000))) return notFound();
  if (!adminWallet(req)) return notFound();
  return NextResponse.json(await adminOverview(), { headers: { "cache-control": "no-store" } });
}
