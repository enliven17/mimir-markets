import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { copyKeyFor } from "@/lib/launch/copy-key";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { allowRequest } from "@/lib/server/rate-limit";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const Body = z.object({ amount: z.number().positive().max(1_000_000), chain: z.literal("solana").default("solana") });
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params, g = await readSigned(req, "copy-withdraw", id); if (!g.ok) return g.res;
  if (!(await allowRequest("launch-copy-withdraw", g.owner, 10, 600_000))) return fail(429, "Too many withdrawals.");
  const b = Body.safeParse(g.body); if (!b.success) return fail(400, "Enter a positive test USDC amount.");
  const c = launchCx(); if (!c) return fail(503, "Launch is not configured.");
  try { return Response.json({ ...await c.client.action(api.solanaCopy.withdraw, { secret: c.secret, agent: copyKeyFor(id), follower: g.owner, amount: b.data.amount }), chain: "solana" }); }
  catch { return fail(502, "The withdrawal could not be confirmed. Check the copy wallet before retrying."); }
}
