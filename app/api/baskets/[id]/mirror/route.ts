/**
 * POST /api/baskets/{id}/mirror: the unsigned Arc call for one copy.
 *
 * Body: `{ follower, claimId }`. The follower must have an active signed subscription and the claim must be a
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
import { zeroAddress } from "viem";
import { ARC } from "@/lib/arc/config";
import { stakeCall } from "@/lib/arc/markets";

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
  const signal = signals.find((s) => s.claimId === claimId);
  if (!signal) {
    return basketFail(409, "no_signal", "no basket member holds an open position you can copy on that claim");
  }

  // Arc: the copy is one stake from the follower's wallet, with the basket's creator as referrer (1% of a
  // winning copy's profit to them, 1% to Mimir, taken by the contract at payout).
  const mimirV3 = ARC.contracts.mimirV3;
  if (mimirV3 && process.env.NEXT_PUBLIC_CONVEX_URL) {
    const referrer = normalizeOwner(basket.creatorWallet) ?? zeroAddress;
    const call = stakeCall(mimirV3, "vs", claimId, BigInt(signal.suggestedStakeUnits) * 1_000_000_000_000n, 2, referrer);
    return basketJson({ ok: true, signal, chain: "arc", call: { to: call.to, data: call.data, value: String(call.value ?? 0n) }, referrer });
  }

  return basketFail(503, "markets_unavailable", "copies need Arc markets, which are not configured on this deploy");
}
