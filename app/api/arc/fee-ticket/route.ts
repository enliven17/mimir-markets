/**
 * GET /api/arc/fee-ticket?account=0x…  →  FeeTicket (lib/arc/fee-tiers.ts)
 *
 * The holder discount for an Arc account, signed for MimirFees.applyTicket.
 * Public on purpose: the ticket names the account and only that account can
 * apply it (the contract checks msg.sender), and a tier is no secret.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { feeTicketFor } from "@/lib/server/fee-ticket";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await allowRequest("arc-fee-ticket", clientIp(req), 30, 60_000))) return tooManyRequests(60);
  const account = new URL(req.url).searchParams.get("account") ?? "";
  if (!isAddress(account)) return NextResponse.json({ error: "account must be an address" }, { status: 400 });
  try {
    return NextResponse.json(await feeTicketFor(account), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.warn("[arc-fee-ticket] failed:", err);
    return NextResponse.json({ error: "the fee ticket is not available" }, { status: 502 });
  }
}
