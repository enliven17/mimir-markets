/**
 * GET  /api/launch/:id                     is served by the page; this route only changes state.
 * POST /api/launch/:id/status { status }   pause, resume or shut down (signed by the owner). Shut down is final.
 */
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await readSigned(req, "status", id);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-status", g.owner, 20, 10 * 60_000))) return fail(429, "Too many changes. Wait a few minutes.");
  const parsed = z.object({ status: z.enum(["live", "paused", "killed"]) }).safeParse(g.body);
  if (!parsed.success) return fail(400, "status must be live, paused or killed");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const ok = await c.client.mutation(api.launch.setStatus, { secret: c.secret, slug: id, owner: g.owner, status: parsed.data.status });
  return ok ? Response.json({ ok: true }) : fail(409, "That change is not allowed for this agent.");
}
