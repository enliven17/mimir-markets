/**
 * POST /api/baskets/{id}/mirror: the unsigned calls for one copy, on the chain the members staked on (copies follow
 * the leader's chain). Arc: one stake call with the USDC as value. Base: an exact USDC approve first when the
 * follower's allowance falls short, then the stake.
 *
 * Body: `{ follower, claimId, chain? }` (chain defaults to arc). The follower must have an active signed subscription and the claim must be a
 * current signal for them; the stake is the signal's suggested stake, so it can never exceed the signed cap. Mimir
 * never signs it and never holds a key; the follower sends it from their own wallet.
 */
import { getSubscription } from "@/lib/baskets-store";
import { findBasket } from "@/lib/house-baskets";
import { loadMirrorSignals } from "@/lib/baskets-performance";
import { normalizeOwner } from "@/lib/owner";
import { storeEnabled } from "@/lib/server/store";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail, basketJson, readJsonBody } from "@/lib/server/basket-http";
import { zeroAddress, type Address } from "viem";
import { actionCalls, type MarketAction } from "@/lib/chains/calls";
import { usdcAllowanceWei } from "@/lib/chains/client";
import { isMarketChainId, marketChain } from "@/lib/chains/registry";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  // Each call reads the chain and fetches a blockhash.
  if (!(await allowRequest("baskets-mirror", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  if (!storeEnabled()) return basketFail(503, "store_unavailable", "baskets need the backend on this deploy");
  const { id } = await ctx.params;

  const body = await readJsonBody(req);
  if (!body) return basketFail(400, "malformed_json", "body is not a JSON object");
  const follower = normalizeOwner(body.follower);
  const claimId = Number(body.claimId);
  const chain = body.chain === undefined ? "arc" : body.chain;
  if (!isMarketChainId(chain)) return basketFail(400, "bad_chain", "chain must be arc or base");
  if (!follower) return basketFail(400, "bad_wallet", "follower must be an EVM address");
  if (!Number.isSafeInteger(claimId) || claimId <= 0) {
    return basketFail(400, "bad_claim", "claimId must be a positive integer");
  }

  const basket = await findBasket(id);
  if (!basket) return basketFail(404, "not_found", "no such basket");
  const subscription = await getSubscription(id, follower).catch(() => null);
  if (!subscription || subscription.perMarketCapUsdc <= 0) {
    return basketFail(403, "not_following", "sign a follow for this basket first");
  }

  const signals = await loadMirrorSignals({
    members: basket.members,
    follower,
    perMarketCapUsdc: subscription.perMarketCapUsdc,
  }).catch(() => []);
  const signal = signals.find((s) => s.claimId === claimId && (s.chain ?? "arc") === chain);
  if (!signal) {
    return basketFail(409, "no_signal", "no basket member holds an open position you can copy on that claim");
  }

  // The copy is one stake from the follower's wallet on the claim's chain, with the basket's creator as referrer (1% of
  // a winning copy's profit to them, 1% to Mimir, taken by the contract at payout).
  const cfg = marketChain(chain);
  if (cfg.enabled && process.env.NEXT_PUBLIC_CONVEX_URL) {
    const referrer = normalizeOwner(basket.creatorWallet) ?? zeroAddress;
    const action: MarketAction = { type: "stake", kind: "vs", marketId: claimId, stake: BigInt(signal.suggestedStakeUnits) * 1_000_000_000_000n, side: 2, referrer };
    const allowance = cfg.usdc.kind === "erc20" && cfg.contracts.mimirV3 ? await usdcAllowanceWei(cfg, follower as Address, cfg.contracts.mimirV3).catch(() => 0n) : 0n;
    const calls = actionCalls(cfg, action, allowance).map((c) => ({ to: c.to, data: c.data, value: String(c.value ?? 0n) }));
    // `call` is the stake itself (older clients); `calls` is what to send, in order.
    return basketJson({ ok: true, signal, chain, chainId: cfg.chainId, call: calls[calls.length - 1], calls, referrer });
  }

  return basketFail(503, "markets_unavailable", `copies need ${cfg.label} markets, which are not configured on this deploy`);
}
