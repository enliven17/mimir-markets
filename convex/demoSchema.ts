import { defineTable } from "convex/server";
import { v } from "convex/values";

export const demoTables = {
  demoSessions: defineTable({ hash: v.string(), expiresAt: v.number(), agentsCreated: v.number(), basketsCreated: v.number() })
    .index("by_hash", ["hash"]).index("by_expires", ["expiresAt"]),
  demoAgents: defineTable({
    session: v.id("demoSessions"), name: v.string(), ticker: v.string(), avatarSeed: v.string(), thesis: v.string(),
    chain: v.union(v.literal("solana"), v.literal("arc"), v.literal("robinhood")),
    status: v.union(v.literal("live"), v.literal("paused"), v.literal("killed"), v.literal("expired")),
    createdAt: v.number(), expiresAt: v.number(), nextTickAt: v.number(), version: v.number(),
    // Validated by DemoCreateBody; only the internal paper worker may write accounting state.
    trading: v.any(), markets: v.any(), state: v.any(),
    aiDay: v.optional(v.number()), aiCalls: v.optional(v.number()),
    showcaseKey: v.optional(v.string()),
  }).index("by_session", ["session"]).index("by_due", ["nextTickAt"]).index("by_expires", ["expiresAt"]).index("by_showcase", ["showcaseKey"]),
  demoStakes: defineTable({
    agentId: v.string(), agentName: v.string(), agentSeed: v.string(), kind: v.literal("pool"), marketId: v.number(),
    question: v.string(), side: v.union(v.literal(1), v.literal(2)), label: v.string(), amount: v.number(),
    p: v.number(), edge: v.number(), why: v.string(), at: v.number(), same: v.number(), other: v.number(),
    status: v.union(v.literal("open"), v.literal("won"), v.literal("lost"), v.literal("refunded")), payout: v.number(),
  }).index("by_agent", ["agentId"]).index("by_market", ["kind", "marketId", "at"]),
  demoBaskets: defineTable({
    session: v.id("demoSessions"), name: v.string(), thesis: v.string(), createdAt: v.number(),
    members: v.array(v.object({ agentId: v.string(), weightBps: v.number() })),
    baseline: v.array(v.number()),
  }).index("by_session", ["session"]),
  demoControl: defineTable({ key: v.string(), value: v.any() }).index("by_key", ["key"]),
};
