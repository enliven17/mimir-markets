import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The Arc markets as indexed from MimirV3 (kind "vs") and MimirPool (kind "pool") by convex/arcSync.ts.
// Amounts are wei strings (18 dp native USDC overflows int64 past ~9.2 USDC); the *Usd floats are for sorting and display.
const kind = v.union(v.literal("vs"), v.literal("pool"));
export const status = v.union(
  v.literal("open"),
  v.literal("active"),
  v.literal("proposed"),
  v.literal("disputed"),
  v.literal("resolved"),
  v.literal("cancelled"),
);

export default defineSchema({
  arcMarkets: defineTable({
    kind,
    marketId: v.number(),
    creator: v.string(),
    question: v.string(),
    /** VS: the creator's position / the counter position. Pool: side A / side B. */
    labelA: v.string(),
    labelB: v.string(),
    resolutionUrl: v.string(),
    category: v.string(),
    deadline: v.number(),
    createdAt: v.number(),
    status,
    /** VS: 1 creator, 2 challengers. Pool: 1 A, 2 B. Both: 3 draw, 4 unresolvable, 0 none yet. */
    winner: v.number(),
    summary: v.string(),
    stakeA: v.string(),
    stakeB: v.string(),
    volumeUsd: v.number(),
    participants: v.number(),
    isPrivate: v.boolean(),
    /** Fee on profit this market settles with (VS: the platform share; an attributed agent may add its own). */
    feeBps: v.number(),
    /** Unix seconds the proposed result can be disputed until; 0 = no proposal yet. */
    disputableUntil: v.number(),
    /** Unix seconds refundExpired opens (7 days after the deadline, or after a dispute). */
    refundAt: v.number(),
    updatedBlock: v.number(),
  })
    .index("by_market", ["kind", "marketId"])
    .index("by_deadline", ["deadline"])
    .index("by_creator", ["creator"]),

  arcPositions: defineTable({
    kind,
    marketId: v.number(),
    /** Lowercase Arc address (the passkey smart account). */
    user: v.string(),
    side: v.number(),
    amount: v.string(),
    amountUsd: v.number(),
    /** Pool: the payout was collected (a Claimed event). VS pays at settlement, so it stays unset. */
    claimed: v.optional(v.boolean()),
  })
    .index("by_market", ["kind", "marketId"])
    .index("by_user", ["user"])
    .index("by_position", ["kind", "marketId", "user", "side"]),

  arcEvents: defineTable({
    kind,
    marketId: v.number(),
    name: v.string(),
    user: v.optional(v.string()),
    amount: v.optional(v.string()),
    txHash: v.string(),
    logIndex: v.number(),
    block: v.number(),
  })
    .index("by_log", ["txHash", "logIndex"])
    .index("by_market", ["kind", "marketId"])
    .index("by_user", ["user"]),

  /** The oracle's verdicts: the audit bundle whose sha256 went on chain as evidenceHash. */
  arcVerdicts: defineTable({
    kind,
    marketId: v.number(),
    side: v.number(),
    confidence: v.number(),
    summary: v.string(),
    evidenceHash: v.string(),
    bundle: v.string(),
    txHash: v.string(),
  }).index("by_market", ["kind", "marketId"]),

  /** Oracle backoff: a market whose decision was deferred (or failed) is not retried before `notBefore` (ms). */
  arcOracleTries: defineTable({
    kind,
    marketId: v.number(),
    notBefore: v.number(),
    attempts: v.number(),
    lastError: v.optional(v.string()),
  }).index("by_market", ["kind", "marketId"]),

  /** One row per indexer: the last Arc block fully applied. */
  arcCursor: defineTable({ name: v.string(), block: v.number() }).index("by_name", ["name"]),
});
