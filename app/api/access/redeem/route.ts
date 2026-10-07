/**
 * POST /api/access/redeem  { code }  →  { result, status }
 *
 * Spend an invite code on the proven wallet (holder proof headers). Each code
 * works once, never for its own owner; a wallet already in keeps its codes.
 */
import { NextResponse } from "next/server";

import { normalizeInvite } from "@/lib/access";
import { accessStatus, isInviteOnly, redeemInvite } from "@/lib/server/access";
import { provenWallet } from "@/lib/server/holder";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const MESSAGES = {
  invalid: "That code does not exist or was already used.",
  own: "That is one of your own codes: share it with someone else.",
} as const;

export async function POST(req: Request) {
  // Tight: codes are short enough that guessing must stay slow.
  if (!(await allowRequest("access-redeem", clientIp(req), 5, 60_000))) return tooManyRequests(60);
  if (!isInviteOnly()) return NextResponse.json({ result: "ok" });
  const wallet = provenWallet(req);
  if (!wallet) return NextResponse.json({ error: "sign in with your wallet first" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? normalizeInvite(body.code) : null;
  if (!code) return NextResponse.json({ error: "Codes look like MIMIR-XXXX-XXXX." }, { status: 400 });
  try {
    const result = await redeemInvite(wallet, code);
    if (result === "invalid" || result === "own") return NextResponse.json({ error: MESSAGES[result] }, { status: 400 });
    return NextResponse.json({ result, status: await accessStatus(wallet) });
  } catch (err) {
    console.error("[access] redeem failed:", err);
    return NextResponse.json({ error: "Redeeming is not available right now." }, { status: 503 });
  }
}
