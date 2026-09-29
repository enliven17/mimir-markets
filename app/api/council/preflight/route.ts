/**
 * POST /api/council/preflight — let a few council personas vet a draft claim
 * before it is published (the optional "Ask the council" check on
 * /arena/create).
 *
 * Body: { question, creatorPosition, counterPosition, resolutionUrl, category?,
 *         settlementRule?, deadlineHours?, personas?: string[] }
 * Returns each persona's open / revise / skip call with a 0-100 score.
 *
 * Free (the source sold it over x402), so it is rate-limited per IP and per
 * deploy, and an identical draft within 10 minutes is served from memory.
 */
import { NextResponse } from "next/server";
import {
  cleanCandidate,
  gatherCouncilPreflight,
  preflightPersonas,
  type PreflightCandidate,
  type PreflightResult,
} from "@/agents/market-creator/council-preflight";
import { cachedFor } from "@/lib/server/ttl-cache";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => NextResponse.json({ success: false, error }, { status });

// An empty panel (every persona's LLM call failed) throws, so it isn't cached.
const cachedPreflight = cachedFor(async (candidate: PreflightCandidate, slugs: string[]): Promise<PreflightResult> => {
  const result = await gatherCouncilPreflight({ candidate, personas: preflightPersonas(slugs) });
  if (result.opinions.length === 0) throw new Error("no persona answered");
  return result;
}, 10 * 60_000);

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await allowRequest("council-preflight", ip, 5, 60_000)) || !(await allowRequest("council-preflight", "all", 30, 60_000))) {
    return tooManyRequests(60);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "invalid JSON body");
  }
  const candidate = cleanCandidate(body);
  if (!candidate) return fail(400, "question, both positions and a resolution URL are required");
  const requested = (body as { personas?: unknown }).personas;
  const slugs = preflightPersonas(Array.isArray(requested) ? requested.map(String) : undefined).map((p) => p.slug);

  try {
    const result = await cachedPreflight(candidate, slugs);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error("[api/council/preflight] failed:", err);
    return fail(503, "the council is unavailable right now");
  }
}
