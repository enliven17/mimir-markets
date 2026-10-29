/**
 * GET /api/launch/:id/detail: an agent's full page (reasoning log, Solana trades and PnL, Arc stakes and their
 * outcomes). Public.
 */
import { api } from "@/convex/_generated/api";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";
import { fail, launchCx } from "@/lib/launch/request";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await allowRequest("launch-detail", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const { id } = await ctx.params;
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const council = COUNCIL_AGENTS[id];
  const agent = council ? null : await c.client.query(api.launch.detail, { secret: c.secret, slug: id });
  if (!council && !agent) return fail(404, "No such agent.");
  const arcAddress = council?.arc ?? agent?.arc ?? null;
  const arc = arcAddress ? await c.client.query(api.launch.arcRecord, { secret: c.secret, address: arcAddress }) : [];
  return Response.json({ agent, arc }, { headers: { "cache-control": "no-store" } });
}
