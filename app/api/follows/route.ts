import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { provenWallet } from "@/lib/server/wallet-proof";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
export const dynamic = "force-dynamic";
const Body = z.object({ target: z.string().max(100), active: z.boolean() });
export async function GET(req: Request) {
  if (!await allowRequest("follows-read", clientIp(req), 60, 60_000)) return tooManyRequests(60);
  const owner = await provenWallet(req); if (!owner) return fail(401, "Verify your wallet to read your follows.");
  const c = launchCx(); if (!c) return fail(503, "Following is unavailable.");
  try { return Response.json(await c.client.query(api.discovery.inbox, { secret: c.secret, owner }), { headers: { "cache-control": "no-store" } }); }
  catch { return fail(503, "Your watchlist is temporarily unavailable."); }
}
export async function POST(req: Request) {
  const g = await readSigned(req, "follow", "discovery"); if (!g.ok) return g.res;
  if (!await allowRequest("follows-write", g.owner, 30, 60_000)) return tooManyRequests(60);
  const b = Body.safeParse(g.body); if (!b.success) return fail(400, "Invalid follow settings.");
  const c = launchCx(); if (!c) return fail(503, "Following is unavailable.");
  try { return Response.json(await c.client.mutation(api.discovery.setFollow, { secret: c.secret, owner: g.owner, ...b.data })); }
  catch { return fail(409, "Could not update this follow. Check your 100-follow limit and try again."); }
}
