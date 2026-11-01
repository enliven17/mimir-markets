/**
 * Copying an agent's market stakes (lib/launch/copy-stake.ts).
 * GET  /api/launch/:id/copy?follower=<0x...>  the follower's subscription: on or off, the copy wallet to fund and its
 *                                             balance (public chain data; no wallet ids).
 * POST /api/launch/:id/copy                    signed by the follower: { arc?: {on, maxPerStakeUsdc}, base?: {...}, active }.
 *                                             Makes the copy wallet on that chain the first time copying is turned on.
 * Copies follow the leader's chain: the agent's Base stakes are copied from the Base copy wallet (USDC + a little ETH for
 * gas), its Arc stakes from the Arc one (USDC only).
 */
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { normalizeOwner } from "@/lib/owner";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";
import { copyKeyFor } from "@/lib/launch/copy-key";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { createWallets } from "@/lib/server/circle-w3s";
import { indexToUsd } from "@/lib/chains/amounts";
import { gasBalanceWei, usdcBalanceWei } from "@/lib/chains/client";
import { circleBlockchain } from "@/lib/chains/house";
import { MARKET_CHAINS } from "@/lib/chains/registry";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({
  arc: z.object({ on: z.boolean(), maxPerStakeUsdc: z.number().min(0.1).max(50) }).optional(),
  base: z.object({ on: z.boolean(), maxPerStakeUsdc: z.number().min(0.1).max(50) }).optional(),
  active: z.boolean(),
});

/** Council personas always stake; a launched agent when its owner turned staking on. */
async function copyable(c: NonNullable<ReturnType<typeof launchCx>>, id: string) {
  if (COUNCIL_AGENTS[id]) return true;
  const card = await c.client.query(api.launch.card, { slug: id });
  return card ? card.markets.enabled : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await allowRequest("launch-copy-read", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const { id } = await ctx.params;
  const follower = normalizeOwner(new URL(req.url).searchParams.get("follower"));
  if (!follower) return fail(400, "follower must be an EVM address");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const can = await copyable(c, id);
  if (can === null) return fail(404, "No such agent.");
  const s = await c.client.query(api.launchCopy.forFollower, { secret: c.secret, agent: copyKeyFor(id), follower });
  const usdc = s?.arc ? await arcPublicClient(ARC).getBalance({ address: s.arc.address as `0x${string}` }).then((w) => Number(w) / 1e18).catch(() => null) : null;
  const baseCfg = MARKET_CHAINS.chains.base;
  const baseW = s?.base ?? null;
  const [baseUsdc, baseEth] = baseW
    ? await Promise.all([
        usdcBalanceWei(baseCfg, baseW.address as `0x${string}`).then(indexToUsd).catch(() => null),
        gasBalanceWei(baseCfg, baseW.address as `0x${string}`).then((w) => Number(w) / 1e18).catch(() => null),
      ])
    : [null, null];
  return Response.json(
    {
      can,
      sub: s && {
        active: s.active,
        pausedReason: s.pausedReason,
        arc: s.arc && { address: s.arc.address, on: s.arc.on, maxPerStakeUsdc: s.arc.maxPerStakeUsdc, balanceUsdc: usdc },
        base: baseW && { address: baseW.address, on: baseW.on, maxPerStakeUsdc: baseW.maxPerStakeUsdc, balanceUsdc: baseUsdc, balanceEth: baseEth },
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await readSigned(req, "copy", id);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-copy", g.owner, 20, 10 * 60_000))) return fail(429, "Too many changes. Wait a few minutes.");
  const parsed = Body.safeParse(g.body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid copy settings.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const can = await copyable(c, id);
  if (can === null) return fail(404, "No such agent.");
  const { arc, base, active } = parsed.data;
  if ((arc?.on || base?.on) && !can) return fail(400, "This agent does not stake on markets.");
  if (base?.on && !MARKET_CHAINS.chains.base.enabled) return fail(400, "Base markets are not configured on this server.");
  const key = copyKeyFor(id);
  try {
    const cur = await c.client.query(api.launchCopy.forFollower, { secret: c.secret, agent: key, follower: g.owner });
    let a = cur?.arc ?? undefined;
    if (arc) {
      if (!a && arc.on) {
        const [w] = await createWallets([`${id}-${g.owner.slice(0, 8)}`], ARC.network === "mainnet" ? "ARC" : "ARC-TESTNET", "mimir-copy");
        a = { walletId: w.id, address: w.address, maxPerStakeUsdc: 0, on: false };
      }
      if (a) a = { ...a, on: arc.on, maxPerStakeUsdc: arc.maxPerStakeUsdc };
    }
    let b = cur?.base ?? undefined;
    if (base) {
      if (!b && base.on) {
        const [w] = await createWallets([`${id}-${g.owner.slice(0, 8)}-base`], circleBlockchain("base", MARKET_CHAINS.chains.base.network), "mimir-copy");
        b = { walletId: w.id, address: w.address, maxPerStakeUsdc: 0, on: false };
      }
      if (b) b = { ...b, on: base.on, maxPerStakeUsdc: base.maxPerStakeUsdc };
    }
    // The stored wallet wins: a racing request's fresh wallet is dropped here, never handed out.
    const stored = await c.client.mutation(api.launchCopy.upsert, { secret: c.secret, agent: key, follower: g.owner, ...(a ? { arc: a } : {}), ...(b ? { base: b } : {}), active });
    return Response.json({ ok: true, arc: stored.arc, base: stored.base });
  } catch (e) {
    console.error(`[launch] copy ${id} failed:`, e);
    return fail(502, "Could not set up the copy wallet. Try again.");
  }
}
