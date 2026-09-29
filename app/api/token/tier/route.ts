/**
 * GET /api/token/tier?wallet=<base58> — a wallet's Mimir token tier from its
 * Solana MAINNET balances (MIMIR once launched, and $ANSEM).
 *
 * Balances are public on chain, so no signature is needed to read them; the
 * perks that act on a tier verify ownership themselves. Rate-limited per IP,
 * balances cached 60s per instance (lib/server/mainnet.ts).
 */
import { NextResponse } from "next/server";
import { normalizeAddress } from "@/lib/agents/signature";
import { walletTier } from "@/lib/server/holder";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { mimirMint, mimirSymbol } from "@/lib/token-config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await allowRequest("token-tier", clientIp(req), 30, 60_000))) return tooManyRequests(60);
  const wallet = normalizeAddress(new URL(req.url).searchParams.get("wallet"));
  if (!wallet) return NextResponse.json({ success: false, error: "wallet must be a Solana public key" }, { status: 400 });

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
