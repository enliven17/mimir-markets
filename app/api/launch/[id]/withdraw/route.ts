/**
 * POST /api/launch/:id/withdraw { chain, amount }: part (or all) of an agent's free balance back to its owner, signed
 * by the owner. Solana: SOL to the owner's wallet (the wallet's Privy policy allows nothing else). Arc: USDC to the
 * Arc account bound to the owner's wallet, never to an address from the request. Open positions and stakes stay put.
 */
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { ARC } from "@/lib/arc/config";
import { arcPublicClient } from "@/lib/arc/chain";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { getSolana } from "@/lib/launch/solana/env";
import { getArcBinding } from "@/lib/server/arc-accounts";
import { transferNative } from "@/lib/server/circle-w3s";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Circle and Solana confirmations wait up to 90 s

/** Left on Arc for the agent's own gas. */
const ARC_GAS_RESERVE_WEI = 50_000_000_000_000_000n; // 0.05 USDC

const Body = z.object({ chain: z.enum(["solana", "arc"]), amount: z.number().positive().max(1_000_000) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await readSigned(req, "withdraw", id);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-withdraw", g.owner, 10, 10 * 60_000))) return fail(429, "Too many withdrawals. Wait a few minutes.");
  const parsed = Body.safeParse(g.body);
  if (!parsed.success) return fail(400, "chain must be solana or arc, with a positive amount");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const a = await c.client.query(api.launch.forLaunch, { secret: c.secret, slug: id });
  if (!a || a.owner !== g.owner) return fail(404, "No such agent.");
  const { chain, amount } = parsed.data;
  const lease = await c.client.mutation(api.launch.leaseForOwner, { secret: c.secret, slug: id, owner: g.owner });
  if (lease === null) return fail(409, "The agent is busy right now (trading or another withdrawal). Try again in a minute.");

  try {
    if (chain === "solana") {
      if (!a.solana) return fail(409, "This agent has no Solana wallet.");
      const solana = getSolana();
      const lamports = BigInt(Math.floor(amount * 1e9));
      // The fee pools (owner payouts, holder airdrops, owed treasury) sit in the same wallet but are owed: never withdrawn.
      const [spendable, reserved] = await Promise.all([solana.executor.spendable(a.solana.address), c.client.query(api.launchFeeDb.reserved, { secret: c.secret, slug: id }).then(BigInt)]);
      const free = spendable > reserved ? spendable - reserved : 0n;
      if (lamports > free) return fail(400, `Only ${Number(free) / 1e9} SOL is free to withdraw (the rest pays fees and rent, is owed from its creator fees, or is in open positions).`);
      const sig = await solana.executor.transferSol({ walletId: a.solana.walletId, wallet: a.solana.address, to: g.owner, lamports });
      await c.client.mutation(api.launch.logEvent, { secret: c.secret, slug: id, kind: "rules", text: `owner withdrew ${amount} SOL (${sig.slice(0, 8)}…)` });
      return Response.json({ tx: sig });
    }
    if (!a.arc) return fail(409, "This agent has no Arc wallet.");
    const to = (await getArcBinding(g.owner))?.arc;
    if (!to) return fail(409, "Link an Arc account to your wallet first; withdrawals go there.");
    const wei = BigInt(Math.floor(amount * 1e6)) * 1_000_000_000_000n;
    const balance = await arcPublicClient(ARC).getBalance({ address: a.arc.address as `0x${string}` });
    // Mimir's share of its Argus fees (convex/launchArgus.ts) sits in the same wallet until the next fee round sends it.
    const keep = ARC_GAS_RESERVE_WEI + BigInt(a.argusOwed6) * 1_000_000_000_000n;
    const free = balance > keep ? balance - keep : 0n;
    if (wei > free) return fail(400, `Only ${Number(free / 1_000_000_000_000n) / 1e6} USDC is free to withdraw (0.05 stays for gas, and Mimir's share of token fees is owed).`);
    const tx = await transferNative({ walletId: a.arc.walletId, to, amount: (Number(wei / 1_000_000_000_000n) / 1e6).toString(), blockchain: ARC.network === "mainnet" ? "ARC" : "ARC-TESTNET" });
    await c.client.mutation(api.launch.logEvent, { secret: c.secret, slug: id, kind: "rules", text: `owner withdrew ${amount} USDC on Arc (${tx.slice(0, 10)}…)` });
    return Response.json({ tx });
  } catch (e) {
    // A send can land after its confirmation timed out: never tell the owner nothing was sent.
    console.error(`[launch] withdraw ${id} ${chain} failed:`, e);
    return fail(502, "The withdrawal could not be confirmed. Check the agent's balance before you try again.");
  } finally {
    await c.client.mutation(api.launch.releaseForOwner, { secret: c.secret, slug: id, token: lease }).catch(() => undefined);
  }
}
