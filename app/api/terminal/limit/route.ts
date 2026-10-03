/**
 * GET /api/terminal/limit?wallet=<base58>: a wallet's terminal spending limit
 * as the chain and the charge ledger see it. Public data (any wallet's token
 * account is public), rate-limited per IP.
 *   → { delegate, approvedToTerminal, delegatedUsdc, balanceUsdc, owedUsdc, availableUsdc }
 */
import { NextResponse } from "next/server";

import { normalizeAddress } from "@/lib/agents/signature";
import { isDbEnabled } from "@/lib/server/db";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { allowanceOf, owedUnits, terminalDelegate } from "@/lib/server/terminal-pay";

export const dynamic = "force-dynamic";

const usdc = (units: bigint) => Number(units) / 1e6;

export async function GET(req: Request) {
  if (!(await allowRequest("terminal-limit", clientIp(req), 30, 60_000))) return tooManyRequests(60);
  const wallet = normalizeAddress(new URL(req.url).searchParams.get("wallet"));
  if (!wallet) return NextResponse.json({ success: false, error: "wallet must be a Solana address" }, { status: 400 });
  const delegate = terminalDelegate();
  if (!delegate) return NextResponse.json({ success: false, error: "paid agents are not switched on yet" }, { status: 503 });
  let allowance, owed;
  try {
    [allowance, owed] = await Promise.all([allowanceOf(wallet), isDbEnabled() ? owedUnits(wallet) : Promise.resolve(0n)]);
  } catch {
    return NextResponse.json({ success: false, error: "could not read the limit right now" }, { status: 503 });
  }
  const approved = allowance.delegate === delegate;
  const delegated = approved ? allowance.delegatedUnits : 0n;
  const room = delegated < allowance.balanceUnits ? delegated : allowance.balanceUnits;
  return NextResponse.json({
    success: true,
    data: {
      delegate,
      approvedToTerminal: approved,
      // Another app holds this account's (single) SPL delegate slot; approving the terminal replaces it.
      otherDelegate: allowance.delegate && !approved ? allowance.delegate : null,
      delegatedUsdc: usdc(delegated),
      balanceUsdc: usdc(allowance.balanceUnits),
      owedUsdc: usdc(owed),
      availableUsdc: Math.max(0, usdc(room - owed)),
    },
  });
}
