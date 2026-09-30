/**
 * GET /api/baskets/{id} — one basket, with its replayed curve.
 *
 * The curve is a projection of what the member agents actually settled on
 * chain (RESOLVED claims in the read index, after the program's profit-only
 * fees). Nothing was deposited and nothing was pooled, so it is explicitly a
 * "what this mix would have done", not a statement about anyone's money.
 */
import { simulateVirtualBasket, VIRTUAL_BASKET_INITIAL_NAV } from "@/lib/baskets";
import { findBasket } from "@/lib/house-baskets";
import { loadMemberSettlements, resolveAgentWallets } from "@/lib/baskets-performance";
import { unitsToUsdc } from "@/lib/money";
import { councilRoster } from "@/lib/server/council-roster";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail, basketJson } from "@/lib/server/basket-http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  if (!(await allowRequest("baskets-read", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const { id } = await ctx.params;

  const basket = await findBasket(id);
  if (!basket) return basketFail(404, "not_found", "no such basket");

  const wallets = await resolveAgentWallets(basket.members.map((m) => m.agentId)).catch(
    () => new Map<string, string>(),
  );
  const settlements = await loadMemberSettlements(basket.members, wallets).catch(() => []);
  const performance = simulateVirtualBasket(basket.members, settlements);
  const personas = new Set(councilRoster().map((p) => p.slug));

  return basketJson(
    {
      ok: true,
      basket: {
        ...basket,
        members: basket.members.map((m) => ({
          ...m,
          kind: personas.has(m.agentId) ? "persona" : "agent",
          wallet: wallets.get(m.agentId) ?? null,
          idle: performance.idleAgents.includes(m.agentId),
        })),
      },
      performance: {
        initialNavUsdc: unitsToUsdc(VIRTUAL_BASKET_INITIAL_NAV),
        finalNavUsdc: unitsToUsdc(performance.finalNavAtomic),
        totalReturn: performance.totalReturn,
        maxDrawdown: performance.maxDrawdown,
        settledMarkets: settlements.length,
        idleAgents: performance.idleAgents,
        points: performance.points.map((p) => ({
          day: p.day,
          navUsdc: unitsToUsdc(p.navAtomic),
          dailyReturn: p.dailyReturn,
          drawdown: p.drawdown,
        })),
      },
    },
    { cache: "s-maxage=30, stale-while-revalidate=120" },
  );
}
