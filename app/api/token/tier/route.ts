/**
 * GET /api/token/tier?wallet=<base58>: a wallet's Mimir token tier from its
 * Solana MAINNET balances (MIMIR once launched, and $ANSEM).
 *
 * GET /api/token/tier?wallets=<base58>,<base58>,…: tiers only, for up to
 * MAX_BATCH wallets (a claim's creator and its 16 challengers), for the holder
 * badges next to avatars. Wallets whose balances cannot be read are left out.
 *
 * Balances are public on chain, so no signature is needed to read them; the
 * perks that act on a tier verify ownership themselves. Rate-limited per IP,
 * balances cached 60s per instance (lib/server/mainnet.ts).
 */
import { NextResponse } from "next/server";
import { normalizeAddress } from "@/lib/agents/signature";
import { walletTier } from "@/lib/server/holder";
import { clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { allowLlmRequest } from "@/lib/server/llm-route-guard";
import { mimirMint, mimirSymbol } from "@/lib/token-config";
import type { TokenTier } from "@/lib/token-tiers";

export const dynamic = "force-dynamic";

const MAX_BATCH = 17;
/** Wallets read at once in a batch: each is two mainnet RPC calls. */
const BATCH_CONCURRENCY = 4;

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

async function batchTiers(req: Request, raw: string) {
  // Each wallet is two mainnet RPC calls: a per-IP limit, a per-network share and a deploy-wide ceiling.
  if (!(await allowLlmRequest({ bucket: "token-tier-batch", key: clientIp(req), perKey: 12, globalEnv: "TOKEN_TIER_BATCH_GLOBAL_PER_MIN", globalDefault: 60 }))) return tooManyRequests(60);
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_BATCH) return bad(`wallets must list 1-${MAX_BATCH} Solana public keys`);
  const wallets: string[] = [];
  for (const p of parts) {
    const w = normalizeAddress(p);
    if (!w) return bad("wallets must list Solana public keys");
    if (!wallets.includes(w)) wallets.push(w);
  }
  const tiers: Record<string, TokenTier> = {};
  for (let i = 0; i < wallets.length; i += BATCH_CONCURRENCY) {
    await Promise.all(
      wallets.slice(i, i + BATCH_CONCURRENCY).map(async (w) => {
        try {
          tiers[w] = (await walletTier(w)).tier;
        } catch {
          /* unreadable right now: no badge */
        }
      }),
    );
  }
  return NextResponse.json({ success: true, data: { tiers } }, { headers: { "cache-control": "private, max-age=60" } });
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const batch = params.get("wallets");
  if (batch !== null) return batchTiers(req, batch);

  if (!(await allowLlmRequest({ bucket: "token-tier", key: clientIp(req), perKey: 30, globalEnv: "TOKEN_TIER_GLOBAL_PER_MIN", globalDefault: 300 }))) return tooManyRequests(60);
  const wallet = normalizeAddress(params.get("wallet"));
  if (!wallet) return bad("wallet must be a Solana public key");

  try {
    const { tier, balances } = await walletTier(wallet);
    return NextResponse.json(
      { success: true, data: { wallet, tier, balances, launched: mimirMint() !== null, symbol: mimirSymbol() } },
      { headers: { "cache-control": "private, max-age=30" } },
    );
  } catch (err) {
    console.warn("[api/token/tier] mainnet read failed:", err);
    return NextResponse.json({ success: false, error: "mainnet is unreachable right now" }, { status: 503 });
  }
}
