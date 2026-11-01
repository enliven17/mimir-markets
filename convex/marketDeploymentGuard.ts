import type { QueryCtx } from "./_generated/server";
import { assertSameDeployment, marketDeployment } from "../lib/chains/deployment";
import { serverMarketChains } from "../lib/chains/registry";

/** Both public reads and internal writes fail closed if env is repointed at another network/deployment. */
export async function assertMarketDeployment(ctx: Pick<QueryCtx, "db">): Promise<void> {
  const registry = serverMarketChains();
  for (const chain of registry.enabled) {
    const stored = await ctx.db.query("marketDeployments").withIndex("by_chain", (q) => q.eq("chain", chain)).unique();
    assertSameDeployment(stored, marketDeployment(registry.chains[chain]));
  }
}
