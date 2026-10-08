/**
 * GET  /api/baskets: the basket directory, ranked by followers.
 * POST /api/baskets: compose a basket.
 *
 * Creating a basket costs nothing and moves nothing, but it is still signed
 * (ed25519 over `composeMessage`, base58): a basket carries its composer's
 * key, and an unsigned one would let anyone publish a thesis under someone
 * else's wallet. The signature carries `signedAt` and expires in 5 minutes.
 * With BASKET_CREATE_MIN_TIER set (and the token launched) the composer must
 * hold that token tier on Solana mainnet.
 */
import { accessDenied } from "@/lib/server/access";
import {
  composeMessage,
  isValidBasketId,
  InvalidBasketError,
  isFreshSignature,
  sanitizeMembers,
  validateBasket,
} from "@/lib/baskets";
import { BasketExistsError, createBasket } from "@/lib/baskets-store";
import { simulateVirtualBasket, VIRTUAL_BASKET_INITIAL_NAV } from "@/lib/baskets";
import { loadMemberSettlements } from "@/lib/baskets-performance";
import { unitsToUsdc } from "@/lib/money";
import { basketDirectory, isHouseBasketId } from "@/lib/house-baskets";
import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { storeEnabled } from "@/lib/server/store";
import { walletTier } from "@/lib/server/holder";
import { mimirMint, mimirSymbol } from "@/lib/token-config";
import { basketMinTierFromEnv, tierAtLeast } from "@/lib/token-tiers";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail, basketJson, readJsonBody } from "@/lib/server/basket-http";

export const dynamic = "force-dynamic";

/** Points kept for a card's sparkline: plenty for 300px, small on the wire. */
const CARD_POINTS = 40;

/** A basket's NAV curve, thinned to CARD_POINTS, and its return. Empty when nothing settled yet. */
async function cardCurve(members: Parameters<typeof loadMemberSettlements>[0]) {
  const settlements = await loadMemberSettlements(members).catch(() => []);
  const perf = simulateVirtualBasket(members, settlements);
  const nav = perf.points.map((p) => unitsToUsdc(p.navAtomic));
  const step = Math.max(1, Math.ceil(nav.length / CARD_POINTS));
  const thin = nav.filter((_, i) => i % step === 0 || i === nav.length - 1);
  return { curve: thin.length >= 2 ? thin : [], totalReturn: perf.totalReturn };
}

export async function GET(): Promise<Response> {
  try {
    // The house baskets need no database, so the directory is never empty.
    const directory = await basketDirectory();
    // ponytail: one settlements read per basket, cached 60s at the edge; a shared read if the directory grows past a few dozen.
    const baskets = await Promise.all(directory.map(async (b) => ({ ...b, ...(await cardCurve(b.members)) })));
    return basketJson(
      { baskets, initialNavUsdc: unitsToUsdc(VIRTUAL_BASKET_INITIAL_NAV) },
      { cache: "s-maxage=60, stale-while-revalidate=120" },
    );
  } catch {
    return basketJson({ baskets: [] });
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!(await allowRequest("baskets-create", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  if (!storeEnabled()) return basketFail(503, "store_unavailable", "baskets need the backend on this deploy");

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
  if (isHouseBasketId(id)) return basketFail(409, "basket_exists", "that id belongs to a council basket");
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
  const denied = await accessDenied(creatorWallet);
  if (denied) return basketFail(403, "invite_only", denied);

  // Token perk: composing can be reserved for holders (BASKET_CREATE_MIN_TIER).
  // The composer signature above proves the wallet, so no extra proof is needed.
  const minTier = basketMinTierFromEnv(mimirMint() !== null);
  if (minTier !== "none") {
    let tier;
    try {
      tier = (await walletTier(creatorWallet)).tier;
    } catch (err) {
      console.warn("[baskets] mainnet tier read failed:", err);
      return basketFail(503, "token_check_unavailable", "token holdings could not be checked, try again shortly");
    }
    if (!tierAtLeast(tier, minTier)) {
      return basketFail(403, "token_gate", `composing a basket needs the ${minTier} tier (${mimirSymbol()} on Solana mainnet)`);
    }
  }

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
