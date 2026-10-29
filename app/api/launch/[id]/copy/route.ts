/**
 * Copy trading an agent (lib/launch/worker/copy.ts).
 * GET  /api/launch/:id/copy?follower=<base58>  the follower's subscription: which sides are on, the copy wallets to
 *                                               fund and their balances (public chain data; no wallet ids).
 * POST /api/launch/:id/copy                     signed by the follower: { solana?: {on, maxPerTradeSol},
 *                                               arc?: {on, maxPerStakeUsdc}, active }. Makes a side's copy wallet the
 *                                               first time it is turned on.
 */
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { normalizeAddress } from "@/lib/agents/signature";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";
import { copyKeyFor } from "@/lib/launch/copy-key";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { copyTradeWalletPolicy } from "@/lib/launch/solana/policy";
import { getSolana } from "@/lib/launch/solana/env";
import { createWallets } from "@/lib/server/circle-w3s";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({
  solana: z.object({ on: z.boolean(), maxPerTradeSol: z.number().min(0.01).max(100) }).optional(),
  arc: z.object({ on: z.boolean(), maxPerStakeUsdc: z.number().min(0.1).max(50) }).optional(),
  active: z.boolean(),
  risk: z.object({
    maxTokenLamports: z.string().regex(/^\d{1,14}$/), maxTotalLamports: z.string().regex(/^\d{1,14}$/),
    dailyLossLamports: z.string().regex(/^\d{1,14}$/), maxDrawdownLamports: z.string().regex(/^\d{1,14}$/),
    maxPriceDriftBps: z.number().int().min(10).max(1000), maxLiquidityBps: z.number().int().min(1).max(100),
  }).optional(),
});

/** What the agent does that can be copied: council personas only stake; a launched agent per its settings. */
async function copyable(c: NonNullable<ReturnType<typeof launchCx>>, id: string) {
  if (COUNCIL_AGENTS[id]) return { solana: false, arc: true };
  const card = await c.client.query(api.launch.card, { slug: id });
  // Copied trades run on Solana: a Robinhood agent's trades (Pons tokens) cannot be copied there, only its Arc stakes.
  return card ? { solana: card.trading.enabled && card.chain === "solana", arc: card.markets.enabled } : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await allowRequest("launch-copy-read", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const { id } = await ctx.params;
  const follower = normalizeAddress(new URL(req.url).searchParams.get("follower"));
  if (!follower) return fail(400, "follower must be a Solana public key");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const can = await copyable(c, id);
  if (!can) return fail(404, "No such agent.");
  const s = await c.client.query(api.launchCopy.forFollower, { secret: c.secret, agent: copyKeyFor(id), follower });
  const risk = await c.client.query(api.copyRisk.policy, { secret: c.secret, follower });
  const [sol, usdc] = await Promise.all([
    s?.solana ? getSolana().executor.spendable(s.solana.address).then((l) => Number(l) / 1e9).catch(() => null) : null,
    s?.arc ? arcPublicClient(ARC).getBalance({ address: s.arc.address as `0x${string}` }).then((w) => Number(w) / 1e18).catch(() => null) : null,
  ]);
  return Response.json(
    {
      can,
      risk,
      sub: s && {
        active: s.active,
        pausedReason: s.pausedReason,
        realizedPnl: s.realizedPnl, receiptsLimited: s.receiptsLimited,
        solana: s.solana && { address: s.solana.address, on: s.solana.on, maxPerTradeSol: Number(BigInt(s.solana.maxPerTradeLamports)) / 1e9, spendableSol: sol },
        arc: s.arc && { address: s.arc.address, on: s.arc.on, maxPerStakeUsdc: s.arc.maxPerStakeUsdc, balanceUsdc: usdc },
        holdings: s.holdings,
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
  if (!can) return fail(404, "No such agent.");
  const { solana, arc, active } = parsed.data;
  if (solana?.on && !can.solana) return fail(400, "This agent does not trade on Solana.");
  if (arc?.on && !can.arc) return fail(400, "This agent does not stake on markets.");
  const key = copyKeyFor(id);
  try {
    const cur = await c.client.query(api.launchCopy.forFollower, { secret: c.secret, agent: key, follower: g.owner });
    let sol = cur?.solana ?? undefined;
    if (solana) {
      if (!sol && solana.on) {
        const s = getSolana();
        const w = await s.privy.createWalletWithPolicy((address) => copyTradeWalletPolicy({ wallet: address, follower: g.owner }));
        sol = { walletId: w.id, address: w.address, maxPerTradeLamports: "0", on: false };
      }
      if (sol) sol = { ...sol, on: solana.on, maxPerTradeLamports: BigInt(Math.round(solana.maxPerTradeSol * 1e9)).toString() };
    }
    let a = cur?.arc ?? undefined;
    if (arc) {
      if (!a && arc.on) {
        const [w] = await createWallets([`${id}-${g.owner.slice(0, 8)}`], ARC.network === "mainnet" ? "ARC" : "ARC-TESTNET", "mimir-copy");
        a = { walletId: w.id, address: w.address, maxPerStakeUsdc: 0, on: false };
      }
      if (a) a = { ...a, on: arc.on, maxPerStakeUsdc: arc.maxPerStakeUsdc };
    }
    // The stored wallets win: a racing request's fresh wallet is dropped here, never handed out.
    const stored = await c.client.mutation(api.launchCopy.upsert, { secret: c.secret, agent: key, follower: g.owner, ...(sol ? { solana: sol } : {}), ...(a ? { arc: a } : {}), ...(parsed.data.risk ? { risk: parsed.data.risk } : {}), active });
    return Response.json({ ok: true, solana: stored.solana, arc: stored.arc });
  } catch (e) {
    console.error(`[launch] copy ${id} failed:`, e);
    return fail(502, "Could not set up the copy wallets. Try again.");
  }
}
