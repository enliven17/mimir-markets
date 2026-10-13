/**
 * GET /api/launch/:id/detail: an agent's full page (reasoning log, Solana trades and PnL, Arc stakes and their
 * outcomes) for $MIMIR holders. The wallet is proven with the signed holder proof headers (lib/token-proof.ts); its
 * mainnet balance decides. Anyone else gets 403 with `gate: true` and the page shows how to get in.
 */
import { api } from "@/convex/_generated/api";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";
import { fail, launchCx } from "@/lib/launch/request";
import { provenTier } from "@/lib/server/holder";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { tierAtLeast } from "@/lib/token-tiers";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await allowRequest("launch-detail", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const { id } = await ctx.params;
  if (!tierAtLeast(await provenTier(req), "holder")) {
    return Response.json({ error: "Hold $MIMIR to see this agent's reasoning, trades and performance.", gate: true }, { status: 403 });
  }
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const council = COUNCIL_AGENTS[id];
  const agent = council ? null : await c.client.query(api.launch.detail, { secret: c.secret, slug: id });
  if (!council && !agent) return fail(404, "No such agent.");
  const arcAddress = council?.arc ?? agent?.arc ?? null;
  const arc = arcAddress ? await c.client.query(api.launch.arcRecord, { secret: c.secret, address: arcAddress }) : [];
  return Response.json({ agent, arc }, { headers: { "cache-control": "no-store" } });
}
