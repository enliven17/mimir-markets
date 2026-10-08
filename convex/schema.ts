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
    /** Unix seconds the proposed result can be disputed until; 0 = no proposal yet. */
    disputableUntil: v.number(),
    /** Unix seconds refundExpired opens (7 days after the deadline, or after a dispute). */
    refundAt: v.number(),
    /** Early close (setLockAt, LockSet): no new stakes from this unix second; 0 or absent = the usual lock. */
    lockAt: v.optional(v.number()),
    /** Disputed by the owner's veto (ResolutionDisputed with a zero disputer), not a participant's bond. */
    vetoed: v.optional(v.boolean()),
    updatedBlock: v.number(),
  })
    .index("by_market", ["kind", "marketId"])
    .index("by_deadline", ["deadline"])
    .index("by_creator", ["creator"])
    // The oracle and the views read by state, oldest deadline first, instead of scanning every market.
    .index("by_status_deadline", ["status", "deadline"]),

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
    /** Block time, unix seconds. */
    at: v.optional(v.number()),
    /** The side the event names: a stake's side, a proposed or final outcome. */
    side: v.optional(v.number()),
  })
    .index("by_log", ["txHash", "logIndex"])
    .index("by_market", ["kind", "marketId"])
    .index("by_user", ["user"])
    .index("by_name", ["name"]),

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

  /** Council persona decisions on Arc markets (convex/arcCouncil.ts); `until` (ms) is when the persona may look again. */
  arcCouncilDecisions: defineTable({
    slug: v.string(),
    kind,
    marketId: v.number(),
    outcome: v.union(v.literal("staked"), v.literal("abstained"), v.literal("retry"), v.literal("failed")),
    rationale: v.string(),
    confidence: v.optional(v.number()),
    amount: v.optional(v.string()),
    txHash: v.optional(v.string()),
    until: v.number(),
    at: v.number(),
  })
    .index("by_persona_market", ["slug", "kind", "marketId"])
    .index("by_market", ["kind", "marketId"])
    .index("by_until", ["until"]),

  /** One council take per market: the best-suited persona's read, no stake (convex/arcCouncil.ts, comment mode). */
  arcMarketTakes: defineTable({
    kind,
    marketId: v.number(),
    slug: v.string(),
    /** The side it leans to: 1 (A / creator), 2 (B / challengers), 0 neither (draw, unresolvable). */
    lean: v.number(),
    confidence: v.number(),
    text: v.string(),
    at: v.number(),
    /** Who opened the market (lowercase), for the per-creator daily cap on takes. */
    creator: v.optional(v.string()),
  }).index("by_market", ["kind", "marketId"]),

  /** One row per indexer: the last Arc block fully applied. */
  arcCursor: defineTable({ name: v.string(), block: v.number() }).index("by_name", ["name"]),

  /** Jev's triage of a new market (lib/jev-triage.ts, convex/arcTriage.ts); empty while TYPESAFE_API_KEY is unset. */
  arcTriage: defineTable({
    kind,
    marketId: v.number(),
    resolvable: v.number(),
    spam: v.number(),
    category: v.string(),
    categoryConfidence: v.number(),
    at: v.number(),
  }).index("by_market", ["kind", "marketId"]),

  /** Admin panel (convex/arcAdmin.ts): when each scheduled job last started, one row per job. */
  arcHeartbeats: defineTable({ name: v.string(), at: v.number() }).index("by_name", ["name"]),

  /**
   * The app's own records, once Postgres tables (convex/appStore.ts, lib/server/store.ts): agents and their API
   * keys, nonces and replies, baskets, copy permissions, invites, Arc account bindings, Telegram chats, the campaign,
   * rate-limit counters and the wallet relay. One row per record: `t` is the old table name, `k` its primary key,
   * `d` the row with the old column names, `i1`/`i2` the one or two columns a table is looked up by (an owner, a
   * follower, a status). Every write goes through a secret-checked mutation; conditional writes are atomic there.
   */
  appStore: defineTable({
    t: v.string(),
    k: v.string(),
    i1: v.optional(v.string()),
    i2: v.optional(v.string()),
    d: v.any(),
    at: v.number(),
  })
    .index("by_key", ["t", "k"])
    .index("by_i1", ["t", "i1"])
    .index("by_i2", ["t", "i2"])
    .index("by_at", ["t", "at"]),
});
