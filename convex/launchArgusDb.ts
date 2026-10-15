// Mimir Launch on Argus: the fee round's reads and writes (convex/launchArgus.ts runs it). The ledger lives on the agent
// (launchAgents.argusFees); the round holds the agent's lease (launchSolDb.acquire) for anything it spends.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { DEFAULT_ALLOCATION } from "../lib/launch/fees";
import type { ArgusFeeAgent } from "../lib/launch/argus-fees";

/** Launched Argus agents with an Arc wallet, oldest round first. ponytail: a full scan, index `token` once there are many. */
export const due = internalQuery({
  args: { max: v.number() },
  handler: async (ctx, { max }): Promise<ArgusFeeAgent[]> => {
    const out: ArgusFeeAgent[] = [];
    for (const a of await ctx.db.query("launchAgents").collect()) {
      if (!a.token || !a.arc || a.status === "pending") continue;
      out.push({
        id: a._id, ticker: a.ticker, walletId: a.arc.walletId, wallet: a.arc.address, splitter: a.token.splitter, locker: a.token.locker,
        creatorBps: a.token.creatorBps, split: a.allocation ?? DEFAULT_ALLOCATION, fees: a.argusFees ?? null,
      });
    }
    return out.sort((x, y) => (x.fees?.lastRoundAt ?? 0) - (y.fees?.lastRoundAt ?? 0)).slice(0, max);
  },
});

const vPending = v.object({ step: v.union(v.literal("claim"), v.literal("treasury")), circleId: v.string(), amount6: v.string(), at: v.number() });

export const save = internalMutation({
  args: {
    id: v.id("launchAgents"),
    fees: v.object({ claimed6: v.string(), owedTreasury6: v.string(), paidTreasury6: v.string(), lastRoundAt: v.number(), pending: v.optional(vPending) }),
  },
  handler: async (ctx, { id, fees }) => {
    await ctx.db.patch(id, { argusFees: fees });
  },
});

export const event = internalMutation({
  args: { id: v.id("launchAgents"), text: v.string(), tx: v.optional(v.string()) },
  handler: async (ctx, { id, text, tx }) => {
    await ctx.db.insert("launchEvents", { agent: id, at: Date.now(), kind: "rules", text: text.slice(0, 300), chain: "arc", ...(tx ? { tx } : {}) });
  },
});
