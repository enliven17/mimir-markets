import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { normalizeOwner } from "@/lib/owner";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";
import { copyKeyFor } from "@/lib/launch/copy-key";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { createHostedWallet } from "@/lib/solana/hosted-wallet";
import { gasBalanceWei, usdcBalanceWei } from "@/lib/chains/client";
import { MARKET_CHAINS } from "@/lib/chains/registry";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const Body = z.object({ solana: z.object({ on: z.boolean(), maxPerStakeUsdc: z.number().min(2).max(50) }), active: z.boolean() });
async function copyable(c: NonNullable<ReturnType<typeof launchCx>>, id: string) {
  if (Object.hasOwn(COUNCIL_AGENTS, id)) return true;
  const card = await c.client.query(api.launch.card, { slug: id }); return card ? card.markets.enabled : null;
}
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await allowRequest("launch-copy-read", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const { id } = await ctx.params, follower = normalizeOwner(new URL(req.url).searchParams.get("follower"));
  if (!follower) return fail(400, "Use a Solana public key.");
  const c = launchCx(); if (!c) return fail(503, "Launch is not configured.");
  const can = await copyable(c, id); if (can === null) return fail(404, "No such agent.");
  const s = await c.client.query(api.solanaCopyDb.forFollower, { secret: c.secret, agent: copyKeyFor(id), follower });
  const cfg = MARKET_CHAINS.chains.solana;
  const [usdc, sol] = s?.solana ? await Promise.all([usdcBalanceWei(cfg, s.solana.address).then(n => Number(n) / 1e18).catch(() => null), gasBalanceWei(cfg, s.solana.address).then(n => Number(n) / 1e9).catch(() => null)]) : [null, null];
  return Response.json({ can, sub: s && { active: s.active, pausedReason: s.pausedReason, solana: s.solana && { ...s.solana, balanceUsdc: usdc, balanceSol: sol } } }, { headers: { "cache-control": "no-store" } });
}
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params, g = await readSigned(req, "copy", id); if (!g.ok) return g.res;
  if (!(await allowRequest("launch-copy", g.owner, 20, 600_000))) return fail(429, "Too many changes.");
  const body = Body.safeParse(g.body); if (!body.success) return fail(400, "Use a cap between 2 and 50 test USDC.");
  const c = launchCx(); if (!c) return fail(503, "Launch is not configured.");
  const can = await copyable(c, id); if (can === null) return fail(404, "No such agent.");
  if (body.data.active && !can) return fail(400, "This agent does not stake on markets.");
  const agent = copyKeyFor(id), cur = await c.client.query(api.solanaCopyDb.forFollower, { secret: c.secret, agent, follower: g.owner });
  const freshWallet = !cur?.solana && body.data.active ? createHostedWallet() : undefined;
  const address = await c.client.mutation(api.solanaCopyDb.save, { secret: c.secret, agent, follower: g.owner, active: body.data.active, ...body.data.solana, ...(freshWallet ? { freshWallet } : {}) });
  return Response.json({ ok: true, solana: address });
}
