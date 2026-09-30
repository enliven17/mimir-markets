/**
 * GET /api/council/roster: both council tracks with each persona's derived
 * Solana address (base58; "" when this deploy has no admin key to derive from).
 * Static per deploy: no chain read, so no rate limit, and CDN-cacheable.
 */
import { NextResponse } from "next/server";
import { councilRoster } from "@/lib/server/council-roster";
import { getPersonaBySlug } from "@/agents/council/personas";

export const dynamic = "force-dynamic";

export function GET() {
  const personas = councilRoster().map((p) => {
    const spec = getPersonaBySlug(p.slug);
    return {
      ...p,
      minConfidence: spec?.minConfidence ?? null,
      stakeUsdc: spec?.stakeUsdc ?? null,
      usesLlm: spec?.archetype !== "rule-based",
    };
  });
  return NextResponse.json(
    { success: true, data: { personas } },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=3600" } },
  );
}
