// Mimir Launch: agent machinery shared by the Arc actions (internal only). The lease keeps one spender per agent
// wallet at a time: an agent opening a market (convex/launchMarkets.ts) and the owner's withdrawal
// (convex/launch.ts leaseForOwner) never send from the same Circle wallet at once.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Longer than a Node action can run (10 min), so a lease never expires under a live action. */
const LEASE_MS = 11 * 60_000;

export const acquire = internalMutation({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }): Promise<number | null> => {
    const a = await ctx.db.get(id);
    const now = Date.now();
    if (!a || (a.leaseUntil !== undefined && a.leaseUntil > now)) return null;
    const until = now + LEASE_MS;
    await ctx.db.patch(id, { leaseUntil: until });
    return until;
  },
});

/** Only clears a lease it still owns, so an action that outlived its lease cannot free someone else's. */
export const release = internalMutation({
  args: { id: v.id("launchAgents"), token: v.number() },
  handler: async (ctx, { id, token }) => {
    const a = await ctx.db.get(id);
    if (a?.leaseUntil === token) await ctx.db.patch(id, { leaseUntil: undefined });
    return null;
  },
});
