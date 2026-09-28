/**
 * GET /api/baskets/candidates — who can be a basket member on this deploy.
 *
 * Council personas whose staking wallet this deploy can derive, plus
 * registered agents (their operator wallet stakes). An unresolvable persona
 * is left out: offering it would promise a leg that never trades.
 */
import { councilRoster } from "@/lib/server/council-roster";
import { listAgents } from "@/lib/agents/store";
import { isDbEnabled } from "@/lib/server/db";
import { basketJson } from "@/lib/server/basket-http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const personas = councilRoster()
    .filter((p) => p.address)
    .map((p) => ({ agentId: p.slug, label: p.displayName, emoji: p.emoji, kind: "persona" as const, wallet: p.address }));
  const agents = isDbEnabled()
    ? (await listAgents(100).catch(() => []))
        .filter((a) => a.status === "active")
        .map((a) => ({
          agentId: a.agentId,
          label: a.displayName || a.agentId,
          emoji: "",
          kind: "agent" as const,
          wallet: a.operatorWallet,
        }))
    : [];
  return basketJson({ candidates: [...personas, ...agents] }, { cache: "s-maxage=60, stale-while-revalidate=300" });
}
