import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { allowRequest } from "@/lib/server/rate-limit";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const Body = z.object({ amount: z.number().positive().max(1_000_000), chain: z.literal("solana").default("solana"), asset: z.enum(["usdc", "sol"]).default("usdc") });
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await readSigned(req, "withdraw", id);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-withdraw", g.owner, 10, 600_000))) return fail(429, "Too many withdrawals. Try again later.");
  const body = Body.safeParse(g.body);
  if (!body.success) return fail(400, "Use a positive amount of devnet USDC or SOL.");
  const c = launchCx(); if (!c) return fail(503, "Launch is not configured.");
  try {
    const r = await c.client.action(api.solanaLaunch.withdraw, { secret: c.secret, owner: g.owner, slug: id, amount: body.data.amount, asset: body.data.asset });
    return Response.json({ ...r, chain: "solana" });
  } catch { return fail(502, "The withdrawal could not be confirmed. Check the agent's balance before retrying."); }
}
