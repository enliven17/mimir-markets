/**
 * GET /api/baskets/{id}/signals?follower=<base58> — what to mirror right now.
 *
 * Open (OPEN / ACTIVE) positions the basket's member agents hold that the
 * follower has not copied yet, with a suggested stake capped by the
 * follower's signed per-market cap. Without `follower` (or for a wallet that
 * does not follow) it lists the members' live positions at their own stake,
 * which is public on-chain data anyway.
 *
 * A signal is only advice. It is executed by the follower: a human via
 * `POST /api/baskets/{id}/mirror` (unsigned transaction) and an agent via its
 * own `challenge` action on the agent API, where its limits apply.
 */
import { getBasket, getSubscription } from "@/lib/baskets-store";
import { loadMirrorSignals } from "@/lib/baskets-performance";
import { normalizeAddress } from "@/lib/agents/signature";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail, basketJson } from "@/lib/server/basket-http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  if (!(await allowRequest("baskets-signals", clientIp(req), 30, 60_000))) return tooManyRequests(60);
  const { id } = await ctx.params;

  const raw = new URL(req.url).searchParams.get("follower");
  const follower = raw ? normalizeAddress(raw) : null;
  if (raw && !follower) return basketFail(400, "bad_wallet", "follower must be a Solana public key");

  const basket = await getBasket(id).catch(() => null);
  if (!basket) return basketFail(404, "not_found", "no such basket");

  const subscription = follower ? await getSubscription(id, follower).catch(() => null) : null;
  const following = Boolean(subscription && subscription.perMarketCapUsdc > 0);

  try {
    const signals = await loadMirrorSignals({
      members: basket.members,
      // A non-follower sees the members' positions, not copies sized for them.
      follower: following ? follower : null,
      perMarketCapUsdc: following ? subscription!.perMarketCapUsdc : 0,
    });
    return basketJson({
      ok: true,
      basketId: id,
      follower,
      following,
      perMarketCapUsdc: following ? subscription!.perMarketCapUsdc : 0,
      signals,
    });
  } catch {
    // No read index: nothing to mirror is the truthful answer.
    return basketJson({ ok: true, basketId: id, follower, following, perMarketCapUsdc: 0, signals: [] });
  }
}
