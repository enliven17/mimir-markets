/**
 * GET  /api/campaign[?wallet=]  the leaderboard (top 100), and that wallet's row, rank and invite code
 * POST /api/campaign            join: { wallet, inviteCode?, signature } over campaignJoinMessage
 *
 * Read-only data is public: every number here is already on chain or in the
 * public directories. Joining needs a wallet signature (free, no transaction)
 * so nobody can sign a wallet up, or pick its referrer, for it.
 */
import { NextResponse } from "next/server";

import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { campaignJoinMessage, INVITE_CODE_PATTERN } from "@/lib/campaign";
import { readLimitedJson } from "@/lib/server/body-limit";
import { campaignBoard, inviteCodeOf, joinCampaign } from "@/lib/server/campaign";
import { isDbEnabled } from "@/lib/server/db";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const TOP = 100;

export async function GET(req: Request) {
  if (!(await allowRequest("campaign-read", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  if (!isDbEnabled()) return NextResponse.json({ rows: [], total: 0, me: null });
  const wallet = normalizeAddress(new URL(req.url).searchParams.get("wallet"));
  try {
    const board = await campaignBoard();
    const index = wallet ? board.findIndex((r) => r.wallet === wallet) : -1;
    const me = wallet
      ? { row: index >= 0 ? board[index] : null, rank: index >= 0 ? index + 1 : null, code: await inviteCodeOf(wallet) }
      : null;
    return NextResponse.json(
      { rows: board.slice(0, TOP), total: board.length, me },
      // The board itself is shared; a wallet's own view is not cached.
      { headers: { "cache-control": wallet ? "no-store" : "s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error("[campaign] board failed:", err);
    return NextResponse.json({ error: "the leaderboard could not be read" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!(await allowRequest("campaign-join", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  const read = await readLimitedJson(req);
  if (!read.ok || !read.value || typeof read.value !== "object") {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: read.ok ? 400 : read.status });
  }
  const body = read.value as Record<string, unknown>;
  const wallet = normalizeAddress(body.wallet);
  const rawCode = typeof body.inviteCode === "string" ? body.inviteCode.trim().toUpperCase() : "";
  if (!wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  if (rawCode && !INVITE_CODE_PATTERN.test(rawCode)) {
    return NextResponse.json({ error: "an invite code is 8 letters and digits" }, { status: 400 });
  }
  const inviteCode = rawCode || null;
  if (!verifyAgentSignature({ address: wallet, message: campaignJoinMessage(wallet, inviteCode), signature: String(body.signature ?? "") })) {
    return NextResponse.json({ error: "signature does not match" }, { status: 401 });
  }
  if (!isDbEnabled()) return NextResponse.json({ error: "the campaign is not configured" }, { status: 503 });
  try {
    const joined = await joinCampaign(wallet, inviteCode);
    return NextResponse.json({ ok: true, code: joined.code, invited: joined.referrer !== null });
  } catch (err) {
    console.error("[campaign] join failed:", err);
    return NextResponse.json({ error: "could not join the campaign" }, { status: 500 });
  }
}
