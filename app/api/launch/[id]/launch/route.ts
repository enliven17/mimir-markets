/** POST /api/launch/:id/launch { sig }: step 2, signed by the owner. Verify the funding tx, then the agent mints its token. */
import { z } from "zod";

import { defaultTokenImage } from "@/lib/launch/token-image";
import { launch } from "@/lib/launch/flow";
import { verifyFunding } from "@/lib/launch/funding";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { getSolana } from "@/lib/launch/solana/env";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // upload + mint + confirm

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9]{2,10}(-\d{1,3})?$/.test(id)) return fail(404, "No such agent.");
  const g = await readSigned(req, "launch", id);
  if (!g.ok) return g.res;
  // Each attempt reads a tx from RPC and may mint: a handful per owner is plenty.
  if (!(await allowRequest("launch-mint", g.owner, 10, 10 * 60_000))) return fail(429, "Too many launch attempts. Wait a few minutes.");
  const parsed = z.object({ sig: z.string().min(80).max(90) }).safeParse(g.body);
  if (!parsed.success) return fail(400, "Missing funding signature.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const solana = getSolana();
  const r = await launch(c, { verify: verifyFunding, conn: solana.connection, launchToken: (a) => solana.executor.launchToken(a), image: defaultTokenImage }, g.owner, id, parsed.data.sig);
  if (!r.ok) return fail(r.status, r.error);
  return Response.json({ mint: r.mint });
}
