/**
 * POST /api/launch/:id/copy/withdraw { amount }: part (or all) of a copy wallet's free USDC back to the follower's own
 * wallet on Arc, signed by the follower. Copied stakes stay put and settle on their own.
 */
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { copyKeyFor } from "@/lib/launch/copy-key";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { normalizeOwner } from "@/lib/owner";
import { transferNative } from "@/lib/server/circle-w3s";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Circle confirmations wait up to 90 s

const ARC_GAS_RESERVE_WEI = 50_000_000_000_000_000n; // 0.05 USDC
const Body = z.object({ amount: z.number().positive().max(1_000_000) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await readSigned(req, "copy-withdraw", id);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-copy-withdraw", g.owner, 10, 10 * 60_000))) return fail(429, "Too many withdrawals. Wait a few minutes.");
  const parsed = Body.safeParse(g.body);
  if (!parsed.success) return fail(400, "amount must be a positive number of USDC");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const s = await c.client.query(api.launchCopy.forFollower, { secret: c.secret, agent: copyKeyFor(id), follower: g.owner });
  if (!s) return fail(404, "You are not copying this agent.");
  const { amount } = parsed.data;
  try {
    if (!s.arc) return fail(409, "You have no copy wallet for this agent.");
    // The owner's EVM wallet is their account on Arc: withdrawals go straight to it.
    const to = normalizeOwner(g.owner);
    if (!to) return fail(409, "Withdrawals go to your EVM wallet: connect one.");
    const wei = BigInt(Math.floor(amount * 1e6)) * 1_000_000_000_000n;
    const balance = await arcPublicClient(ARC).getBalance({ address: s.arc.address as `0x${string}` });
    const free = balance > ARC_GAS_RESERVE_WEI ? balance - ARC_GAS_RESERVE_WEI : 0n;
    if (wei > free) return fail(400, `Only ${Number(free / 1_000_000_000_000n) / 1e6} USDC is free to withdraw (0.05 stays for gas).`);
    const tx = await transferNative({ walletId: s.arc.walletId, to, amount: (Number(wei / 1_000_000_000_000n) / 1e6).toString(), blockchain: ARC.network === "mainnet" ? "ARC" : "ARC-TESTNET" });
    return Response.json({ tx });
  } catch (e) {
    // A send can land after its confirmation timed out: never tell the follower nothing was sent.
    console.error(`[launch] copy withdraw ${id} failed:`, e);
    return fail(502, "The withdrawal could not be confirmed. Check the copy wallet's balance before you try again.");
  }
}
