/**
 * POST /api/baskets/{id}/mirror — the unsigned transaction for one copy.
 *
 * Body: `{ follower, claimId }`. The follower must have an active signed
 * subscription and the claim must be a current signal for them; the stake is
 * the signal's suggested stake, so it can never exceed the signed cap. The
 * transaction is built by the agent API's builder (lib/agents/chain.ts):
 * fee payer = follower, ER when the claim is delegated, unsigned. Mimir never
 * signs it and never holds a key; the follower signs and sends it themselves.
 */
import { getBasket, getSubscription } from "@/lib/baskets-store";
import { loadMirrorSignals } from "@/lib/baskets-performance";
import { normalizeAddress } from "@/lib/agents/signature";
import { AgentEnvelopeError } from "@/lib/agents/api";
import { prepareWrite } from "@/lib/agents/chain";
import { isDbEnabled } from "@/lib/server/db";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail, basketJson, readJsonBody } from "@/lib/server/basket-http";
import { PublicKey } from "@solana/web3.js";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  // Each call reads the chain and fetches a blockhash.
  if (!(await allowRequest("baskets-mirror", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  if (!isDbEnabled()) return basketFail(503, "store_unavailable", "baskets need a database on this deploy");
  const { id } = await ctx.params;

  const body = await readJsonBody(req);
  if (!body) return basketFail(400, "malformed_json", "body is not a JSON object");
  const follower = normalizeAddress(body.follower);
  const claimId = Number(body.claimId);
  if (!follower) return basketFail(400, "bad_wallet", "follower must be a Solana public key");
  if (!Number.isSafeInteger(claimId) || claimId <= 0) {
    return basketFail(400, "bad_claim", "claimId must be a positive integer");
  }

  const basket = await getBasket(id).catch(() => null);
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

  try {
    const prepared = await prepareWrite(
      { action: "challenge", params: { claimId: BigInt(claimId), stakeUnits: BigInt(signal.suggestedStakeUnits) } },
      { operator: new PublicKey(follower), agentOwner: null },
    );
    return basketJson({ ok: true, signal, transactions: prepared.transactions });
  } catch (err) {
    // Builder errors are ours (balance not delegated, claim closed, ...): safe to relay.
    if (err instanceof AgentEnvelopeError) return basketFail(err.status, err.reason, err.message);
    console.error("[baskets] mirror build failed:", err);
    return basketFail(503, "chain_unavailable", "the transaction could not be built, try again shortly");
  }
}
