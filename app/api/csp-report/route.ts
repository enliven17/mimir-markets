/**
 * POST /api/csp-report: where browsers send report-only CSP violations
 * (lib/server/csp.ts). Logged, truncated, rate-limited per IP; the log is the
 * list to clear before the policy is enforced.
 */
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (await allowRequest("csp-report", clientIp(req), 30, 60_000)) {
    const text = await req.text().catch(() => "");
    console.warn("[csp-report]", text.slice(0, 1_000));
  }
  return new Response(null, { status: 204 });
}
