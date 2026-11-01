/**
 * POST /api/launch/:id/withdraw { amount }: part (or all) of an agent's free USDC on Arc back to its owner's wallet,
 * signed by the owner. Never to an address from the request. Open stakes stay put and settle on their own.
 */
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { ARC } from "@/lib/arc/config";
import { arcPublicClient } from "@/lib/arc/chain";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { normalizeOwner } from "@/lib/owner";
import { transferNative } from "@/lib/server/circle-w3s";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Circle confirmations wait up to 90 s

/** Left on Arc for the agent's own gas. */
const ARC_GAS_RESERVE_WEI = 50_000_000_000_000_000n; // 0.05 USDC

const Body = z.object({ amount: z.number().positive().max(1_000_000) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await readSigned(req, "withdraw", id);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-withdraw", g.owner, 10, 10 * 60_000))) return fail(429, "Too many withdrawals. Wait a few minutes.");
  const parsed = Body.safeParse(g.body);
  if (!parsed.success) return fail(400, "amount must be a positive number of USDC");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const a = await c.client.query(api.launch.forOwner, { secret: c.secret, slug: id });
  if (!a || a.owner !== g.owner) return fail(404, "No such agent.");
  // The owner's EVM wallet is their account on Arc: withdrawals go straight to it.
  const to = normalizeOwner(g.owner);
  if (!to) return fail(409, "Withdrawals go to your EVM wallet: connect one.");
  const { amount } = parsed.data;
  const lease = await c.client.mutation(api.launch.leaseForOwner, { secret: c.secret, slug: id, owner: g.owner });
  if (lease === null) return fail(409, "The agent is busy right now (opening a market or another withdrawal). Try again in a minute.");

  try {
    const wei = BigInt(Math.floor(amount * 1e6)) * 1_000_000_000_000n;
    const balance = await arcPublicClient(ARC).getBalance({ address: a.arc.address as `0x${string}` });
    const free = balance > ARC_GAS_RESERVE_WEI ? balance - ARC_GAS_RESERVE_WEI : 0n;
    if (wei > free) return fail(400, `Only ${Number(free / 1_000_000_000_000n) / 1e6} USDC is free to withdraw (0.05 stays for gas).`);
    const tx = await transferNative({ walletId: a.arc.walletId, to, amount: (Number(wei / 1_000_000_000_000n) / 1e6).toString(), blockchain: ARC.network === "mainnet" ? "ARC" : "ARC-TESTNET" });
    await c.client.mutation(api.launch.logEvent, { secret: c.secret, slug: id, kind: "rules", text: `owner withdrew ${amount} USDC on Arc (${tx.slice(0, 10)}…)` });
    return Response.json({ tx });
  } catch (e) {
    // A send can land after its confirmation timed out: never tell the owner nothing was sent.
    console.error(`[launch] withdraw ${id} failed:`, e);
    return fail(502, "The withdrawal could not be confirmed. Check the agent's balance before you try again.");
  } finally {
    await c.client.mutation(api.launch.releaseForOwner, { secret: c.secret, slug: id, token: lease }).catch(() => undefined);
  }
}
