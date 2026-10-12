/**
 * GET  /api/admin/invites                     → { invites }   every code, newest first
 * POST /api/admin/invites { count, note? }    → { codes, invites }   mint 1–50 admin codes
 * Admin session only (lib/server/admin.ts); everyone else gets a plain 404, like the overview.
 */
import { NextResponse } from "next/server";

import { listInvites, mintAdminInvites } from "@/lib/server/access";
import { adminWallet } from "@/lib/server/admin";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });
const noStore = { headers: { "cache-control": "no-store" } };

export async function GET(req: Request) {
  if (!(await allowRequest("admin", clientIp(req), 20, 60_000))) return notFound();
  if (!(await adminWallet(req))) return notFound();
  return NextResponse.json({ invites: await listInvites() }, noStore);
}

export async function POST(req: Request) {
  if (!(await allowRequest("admin-invites", clientIp(req), 10, 60_000))) return notFound();
  if (!(await adminWallet(req))) return notFound();
  const body = (await req.json().catch(() => null)) as { count?: unknown; note?: unknown } | null;
  const count = Number(body?.count);
  if (!Number.isInteger(count) || count < 1 || count > 50) return NextResponse.json({ error: "count must be 1–50" }, { status: 400 });
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 60) : null;
  const codes = await mintAdminInvites(count, note);
  return NextResponse.json({ codes, invites: await listInvites() }, noStore);
}
