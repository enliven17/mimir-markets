/**
 * GET /api/admin/nonce?wallet=<Solana wallet>: a single-use sign-in challenge for an ADMIN_WALLETS wallet
 * (lib/server/admin.ts), bound to this site's domain. Anyone else gets a plain 404.
 */
import { NextResponse } from "next/server";

import { normalizeAddress } from "@/lib/agents/signature";
import { issueAdminNonce } from "@/lib/server/admin";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

export async function GET(req: Request) {
  if (!(await allowRequest("admin-nonce", clientIp(req), 10, 60_000))) return notFound();
  const wallet = normalizeAddress(new URL(req.url).searchParams.get("wallet"));
  if (!wallet) return notFound();
  const challenge = await issueAdminNonce(wallet, new URL(req.url).host).catch(() => null);
  if (!challenge) return notFound();
  return NextResponse.json(challenge, { headers: { "cache-control": "no-store" } });
}
