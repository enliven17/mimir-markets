/**
 * POST /api/admin/session {wallet, nonce, signature}: trades a signed admin challenge (GET /api/admin/nonce) for a
 * 10-minute session token (lib/server/admin.ts). The nonce works once and only from the domain it was issued for.
 */
import { NextResponse } from "next/server";

import { normalizeAddress } from "@/lib/agents/signature";
import { startAdminSession } from "@/lib/server/admin";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

export async function POST(req: Request) {
  if (!(await allowRequest("admin-session", clientIp(req), 10, 60_000))) return notFound();
  const body = (await req.json().catch(() => null)) as { wallet?: unknown; nonce?: unknown; signature?: unknown } | null;
  const wallet = normalizeAddress(body?.wallet);
  if (!wallet || typeof body?.nonce !== "string" || typeof body?.signature !== "string") return notFound();
  const session = await startAdminSession({ wallet, nonce: body.nonce, signature: body.signature, origin: req.headers.get("origin") }).catch(() => null);
  if (!session) return notFound();
  return NextResponse.json(session, { headers: { "cache-control": "no-store" } });
}
