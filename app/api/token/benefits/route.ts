import { api } from "@/convex/_generated/api";
import { launchCx, fail } from "@/lib/launch/request";
import { provenWallet, walletBalances } from "@/lib/server/holder";
import { getArcBinding } from "@/lib/server/arc-accounts";
import { tierFor, tierThresholdsFromEnv } from "@/lib/token-tiers";
import { previewBenefits } from "@/lib/token-benefits";
import { feeTierFor, ENTRY_FEE_BPS } from "@/lib/arc/fee-tiers";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!await allowRequest("token-benefits", clientIp(req), 20, 60_000)) return tooManyRequests(60);
  const owner = await provenWallet(req); if (!owner) return fail(401, "Verify your wallet to view your benefits.");
  const c = launchCx(); if (!c) return fail(503, "Benefits are unavailable.");
  try {
    const [balances, binding] = await Promise.all([walletBalances(owner), getArcBinding(owner)]);
    const tier = tierFor({ mimir: balances.mimir, ansem: 0 }, tierThresholdsFromEnv());
    const usage = await c.client.query(api.tokenBenefits.usage, { secret: c.secret, owner, ...(binding ? { arc: binding.arc } : {}) });
    return Response.json({ tier, benefits: previewBenefits(tier), entryBps: ENTRY_FEE_BPS[feeTierFor(balances.mimir)], usage }, { headers: { "cache-control": "no-store" } });
  } catch { return fail(503, "Could not verify your benefits. Refresh to try again."); }
}
