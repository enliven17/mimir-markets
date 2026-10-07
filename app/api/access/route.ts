/**
 * GET /api/access  →  AccessStatus (lib/access.ts)
 *
 * Whether the proven wallet may use the app while it is invite-only, and its
 * invite codes if it is a holder. The wallet is proven by the signed holder
 * proof headers (lib/token-proof.ts), so nobody reads another wallet's codes.
 * Open (testnet): always allowed, no proof needed.
 */
import { NextResponse } from "next/server";

import { accessMinMimir } from "@/lib/access";
import { accessStatus, isInviteOnly } from "@/lib/server/access";
import { storeEnabled } from "@/lib/server/store";
import { provenWallet } from "@/lib/server/holder";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const minMimir = accessMinMimir();
  if (!isInviteOnly()) return NextResponse.json({ inviteOnly: false, allowed: true, via: "open", invites: [], minMimir });
  if (!(await allowRequest("access", clientIp(req), 30, 60_000))) return tooManyRequests(60);
  const wallet = provenWallet(req);
  if (!wallet) return NextResponse.json({ inviteOnly: true, allowed: false, via: null, invites: [], minMimir, needsProof: true });
  if (!storeEnabled()) return NextResponse.json({ error: "access is not available right now" }, { status: 503 });
  try {
    return NextResponse.json(await accessStatus(wallet), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[access] status failed:", err);
    return NextResponse.json({ error: "access is not available right now" }, { status: 503 });
  }
}
