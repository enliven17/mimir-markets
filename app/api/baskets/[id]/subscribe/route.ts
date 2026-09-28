/**
 * POST /api/baskets/{id}/subscribe — follow, re-cap, or unfollow.
 *
 * Following is mirroring, never depositing. This route stores a signed intent
 * (ed25519 over `followMessage`, base58) and a per-market ceiling; it never
 * takes custody of anything and cannot stake on the follower's behalf.
 * Setting the cap to zero unfollows, so a revocation is the same signature
 * shape as a grant.
 *
 * Replay: `signedAt` must be within 5 minutes of server time AND newer than
 * the signature on file (enforced atomically in the upsert), so an old
 * "cap 50" cannot be replayed after an unfollow.
 */
import {
  followMessage,
  isFreshSignature,
  isValidFollowCap,
  MAX_FOLLOW_CAP_USDC,
  MIN_FOLLOW_CAP_USDC,
} from "@/lib/baskets";
import { getBasket, getSubscription, setSubscription } from "@/lib/baskets-store";
import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { isDbEnabled } from "@/lib/server/db";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail, basketJson, readJsonBody } from "@/lib/server/basket-http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  if (!(await allowRequest("baskets-follow", clientIp(req), 20, 60_000))) return tooManyRequests(60);
  if (!isDbEnabled()) return basketFail(503, "store_unavailable", "baskets need a database on this deploy");
  const { id } = await ctx.params;

  const body = await readJsonBody(req);
  if (!body) return basketFail(400, "malformed_json", "body is not a JSON object");

  const follower = normalizeAddress(body.follower);
  const signature = String(body.signature ?? "");
  const perMarketCapUsdc = Number(body.perMarketCapUsdc ?? 0);
  const signedAt = Number(body.signedAt);

  if (!follower) return basketFail(400, "bad_wallet", "follower must be a Solana public key");
  if (!isFreshSignature(signedAt)) {
    return basketFail(401, "stale_signature", "signedAt must be a ms timestamp within 5 minutes of now");
  }
  if (!isValidFollowCap(perMarketCapUsdc)) {
    return basketFail(
      400,
      "bad_cap",
      `perMarketCapUsdc must be 0 (unfollow) or ${MIN_FOLLOW_CAP_USDC}-${MAX_FOLLOW_CAP_USDC} USDC`,
    );
  }

  const basket = await getBasket(id).catch(() => null);
  if (!basket) return basketFail(404, "not_found", "no such basket");

  const signedOk = verifyAgentSignature({
    address: follower,
    message: followMessage({ basketId: id, follower, perMarketCapUsdc, signedAt }),
    signature,
  });
  if (!signedOk) return basketFail(401, "bad_signature", "the follower signature does not match");

  try {
    const stored = await setSubscription({ basketId: id, follower, perMarketCapUsdc, signature, signedAt });
    if (!stored) {
      return basketFail(409, "signature_replay", "a newer subscription signature is already on file");
    }
    const current = await getSubscription(id, follower);
    return basketJson({
      ok: true,
      following: (current?.perMarketCapUsdc ?? perMarketCapUsdc) > 0,
      perMarketCapUsdc: current?.perMarketCapUsdc ?? perMarketCapUsdc,
      // Stated explicitly so nobody reads "following" as "funds moved".
      custody: "none: positions are staked from your own balance with your own signature",
    });
  } catch (err) {
    console.error("[baskets] subscribe failed:", err);
    return basketFail(500, "internal_error", "the subscription could not be stored");
  }
}
