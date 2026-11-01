/**
 * POST /api/launch/:id/withdraw { amount, chain?, asset? }: part (or all) of an agent's free funds on one chain back to
 * its owner's wallet, signed by the owner. Never to an address from the request. Open stakes stay put and settle on
 * their own.
 *   chain  "arc" (default, as before Base) or "base"
 *   asset  "usdc" (default) or, on Base, "eth": the gas money the owner sent it
 * On Arc 0.05 USDC stays for the agent's gas; on Base gas is ETH, so all its USDC is free.
 */
import { z } from "zod";
import type { Address } from "viem";

import { api } from "@/convex/_generated/api";
import { indexToDecimal6 } from "@/lib/chains/amounts";
import { MARKET_CHAINS } from "@/lib/chains/registry";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { normalizeOwner } from "@/lib/owner";
import { circleSendGas, circleSendUsdc, walletGasWei, walletUsdcWei } from "@/lib/server/chain-circle";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Circle confirmations wait up to 90 s

/** Left on Arc for the agent's own gas. */
const ARC_GAS_RESERVE_WEI = 50_000_000_000_000_000n; // 0.05 USDC

const Body = z.object({
  amount: z.number().positive().max(1_000_000),
  chain: z.enum(["arc", "base"]).default(MARKET_CHAINS.defaultChain),
  asset: z.enum(["usdc", "eth"]).default("usdc"),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await readSigned(req, "withdraw", id);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-withdraw", g.owner, 10, 10 * 60_000))) return fail(429, "Too many withdrawals. Wait a few minutes.");
  const parsed = Body.safeParse(g.body);
  if (!parsed.success) return fail(400, "amount must be a positive number");
  const { amount, chain, asset } = parsed.data;
  const cfg = MARKET_CHAINS.chains[chain];
  if (asset === "eth" && cfg.gas.symbol !== "ETH") return fail(400, "ETH withdrawals are for Base only.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const a = await c.client.query(api.launch.forOwner, { secret: c.secret, slug: id });
  if (!a || a.owner !== g.owner) return fail(404, "No such agent.");
  const wallet = chain === "arc" ? a.arc : a.base;
  if (!wallet) return fail(409, `The agent has no ${cfg.label} wallet yet.`);
  // The owner's EVM wallet is their account on every chain: withdrawals go straight to it.
  const to = normalizeOwner(g.owner);
  if (!to) return fail(409, "Withdrawals go to your EVM wallet: connect one.");
  const lease = await c.client.mutation(api.launch.leaseForOwner, { secret: c.secret, slug: id, owner: g.owner });
  if (lease === null) return fail(409, "The agent is busy right now (opening a market or another withdrawal). Try again in a minute.");

  try {
    let tx: string;
    if (asset === "eth") {
      const wei = BigInt(Math.floor(amount * 1e9)) * 1_000_000_000n; // gwei precision
      const balance = await walletGasWei(cfg, wallet.address);
      if (wei > balance) return fail(400, `Only ${Number(balance) / 1e18} ETH is in its ${cfg.label} wallet.`);
      tx = await circleSendGas(cfg, wallet.walletId, to as Address, wei);
    } else {
      const wei = BigInt(Math.floor(amount * 1e6)) * 1_000_000_000_000n;
      const balance = await walletUsdcWei(cfg, wallet.address);
      const reserve = cfg.gas.symbol === "USDC" ? ARC_GAS_RESERVE_WEI : 0n;
      const free = balance > reserve ? balance - reserve : 0n;
      if (wei > free) return fail(400, `Only ${indexToDecimal6(free)} USDC is free to withdraw on ${cfg.label}${reserve ? " (0.05 stays for gas)" : ""}.`);
      tx = await circleSendUsdc(cfg, wallet.walletId, to as Address, wei);
    }
    await c.client.mutation(api.launch.logEvent, { secret: c.secret, slug: id, kind: "rules", text: `owner withdrew ${amount} ${asset.toUpperCase()} on ${cfg.label} (${tx.slice(0, 10)}…)` });
    return Response.json({ tx, chain });
  } catch (e) {
    // A send can land after its confirmation timed out: never tell the owner nothing was sent.
    console.error(`[launch] withdraw ${id} failed:`, e);
    return fail(502, "The withdrawal could not be confirmed. Check the agent's balance before you try again.");
  } finally {
    await c.client.mutation(api.launch.releaseForOwner, { secret: c.secret, slug: id, token: lease }).catch(() => undefined);
  }
}
