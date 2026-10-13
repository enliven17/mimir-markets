/**
 * POST /api/launch/:id/allocation { allocation }: the owner changes where the agent's creator fees go (signed by the
 * owner). Public at once, in force 24 hours later; a newer change replaces a pending one (convex/launchFeeDb.ts).
 */
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { AllocationBody } from "@/lib/launch/flow";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await readSigned(req, "allocation", id);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-allocation", g.owner, 20, 60 * 60_000))) return fail(429, "Too many changes this hour.");
  const parsed = z.object({ allocation: AllocationBody }).safeParse(g.body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Bad split.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const r = await c.client.mutation(api.launchFeeDb.requestAllocation, { secret: c.secret, slug: id, owner: g.owner, allocation: parsed.data.allocation });
  return r.ok ? Response.json({ effectiveAt: r.effectiveAt }) : fail(403, r.error);
}
