/**
 * GET /api/challenge-opportunities?limit=8 — source-backed claim drafts for the
 * arena feed. Read-only: the set is rebuilt by the market-creator worker, so
 * no request here triggers an LLM call. Behind NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS.
 */
import { NextResponse } from "next/server";

import { createApiError } from "@/lib/server/api-validation";
import { getChallengeOpportunities, MAX_OPPORTUNITIES_LIMIT } from "@/lib/server/challenge-opportunities";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const PER_MINUTE = 60;

export async function GET(request: Request) {
  if (process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS !== "1") {
    return NextResponse.json(createApiError("feature_disabled", "Challenge opportunities are not enabled"), { status: 404 });
  }
  if (!(await allowRequest("challenge-opportunities", clientIp(request), PER_MINUTE, 60_000))) {
    return tooManyRequests(60);
  }

  const raw = new URL(request.url).searchParams.get("limit");
  let limit: number | undefined;
  if (raw !== null && raw.trim() !== "") {
    limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_OPPORTUNITIES_LIMIT) {
      return NextResponse.json(
        createApiError("invalid_parameter", `limit must be an integer from 1 to ${MAX_OPPORTUNITIES_LIMIT}`),
        { status: 400 },
      );
    }
  }

  try {
    const result = await getChallengeOpportunities({ limit });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json(
      createApiError("challenge_opportunities_error", "Unable to load challenge opportunities"),
      { status: 500 },
    );
  }
}
