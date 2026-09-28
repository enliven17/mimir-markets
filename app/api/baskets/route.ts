/**
 * GET  /api/baskets — the basket directory, ranked by followers.
 * POST /api/baskets — compose a basket.
 *
 * Creating a basket costs nothing and moves nothing, but it is still signed
 * (ed25519 over `composeMessage`, base58): a basket carries its composer's
 * key, and an unsigned one would let anyone publish a thesis under someone
 * else's wallet. The signature carries `signedAt` and expires in 5 minutes.
 */
import {
  composeMessage,
  isValidBasketId,
  InvalidBasketError,
  isFreshSignature,
  sanitizeMembers,
  validateBasket,
} from "@/lib/baskets";
import { BasketExistsError, createBasket, listBaskets } from "@/lib/baskets-store";
import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { isDbEnabled } from "@/lib/server/db";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail, basketJson, readJsonBody } from "@/lib/server/basket-http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const baskets = isDbEnabled() ? await listBaskets() : [];
    return basketJson({ baskets }, { cache: "s-maxage=15, stale-while-revalidate=60" });
  } catch {
    // No database, or it is down: an empty directory is truthful, a 500 is not.
    return basketJson({ baskets: [] });
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!(await allowRequest("baskets-create", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  if (!isDbEnabled()) return basketFail(503, "store_unavailable", "baskets need a database on this deploy");

  const body = await readJsonBody(req);
  if (!body) return basketFail(400, "malformed_json", "body is not a JSON object");

  const id = String(body.id ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const thesis = String(body.thesis ?? "").trim();
  const creatorWallet = normalizeAddress(body.creatorWallet);
  const signature = String(body.signature ?? "");
  const signedAt = Number(body.signedAt);
  const members = sanitizeMembers(body.members);

  if (!isValidBasketId(id)) {
    return basketFail(400, "bad_id", "id must be 3-64 chars of [a-z0-9-], starting alphanumeric");
  }
  if (!creatorWallet) return basketFail(400, "bad_wallet", "creatorWallet must be a Solana public key");
  if (!isFreshSignature(signedAt)) {
    return basketFail(401, "stale_signature", "signedAt must be a ms timestamp within 5 minutes of now");
  }

  try {
    validateBasket({ name, thesis, members });
  } catch (err) {
    if (err instanceof InvalidBasketError) return basketFail(400, err.reason, err.message);
    throw err;
  }

  const signedOk = verifyAgentSignature({
    address: creatorWallet,
    message: composeMessage({ id, name, thesis, creator: creatorWallet, members, signedAt }),
    signature,
  });
  if (!signedOk) return basketFail(401, "bad_signature", "the composer signature does not match");

  try {
    const basket = await createBasket({ id, name, thesis, creatorWallet, members, signature });
    return basketJson({ ok: true, basket }, { status: 201 });
  } catch (err) {
    if (err instanceof BasketExistsError) return basketFail(409, "basket_exists", "that basket id is taken");
    if (err instanceof InvalidBasketError) return basketFail(400, err.reason, err.message);
    console.error("[baskets] create failed:", err);
    return basketFail(500, "internal_error", "the basket could not be stored");
  }
}
