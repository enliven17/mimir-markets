/**
 * POST /api/launch/:id/copy/drain {}: the follower's "sell my copied tokens", signed by the follower. Stops new Solana
 * copies and sells what the copy wallet actually holds of every mint it copied (convex/launchCopyJobs.ts drain); the
 * SOL is then free to withdraw (copy/withdraw). Never needs $MIMIR: leaving is always allowed.
 */
import { api } from "@/convex/_generated/api";
import { copyKeyFor } from "@/lib/launch/copy-key";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await readSigned(req, "copy-drain", id);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-copy-drain", g.owner, 5, 10 * 60_000))) return fail(429, "Too many requests. Wait a few minutes.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const ok = await c.client.mutation(api.launchCopy.requestDrain, { secret: c.secret, agent: copyKeyFor(id), follower: g.owner });
  return ok ? Response.json({ ok: true }) : fail(404, "You have no Solana copy wallet for this agent.");
}
