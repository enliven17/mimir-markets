import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The markets of every market chain (lib/chains/registry.ts: Base, Arc) as indexed from MimirV3 (kind "vs") and
// MimirPool (kind "pool") by convex/arcSync.ts. The arc* table names are historical: every market row carries its
// `chain`, and (chain, kind, marketId) is the key. Rows written before Base have no `chain`: they are Arc's
// (convex/chainMigrate.ts backfills them; reads treat a missing chain as "arc").
// Amounts are 18-dp index-unit strings on every chain (lib/chains/amounts.ts: Base's 6-dp USDC is scaled by 1e12 on
// the way in; 18 dp overflows int64 past ~9.2 USDC); the *Usd floats are for sorting and display.
const kind = v.union(v.literal("vs"), v.literal("pool"));
export const vChain = v.union(v.literal("arc"), v.literal("base"));
/** Optional only so pre-Base rows validate until the backfill; every new row sets it. */
const chain = v.optional(vChain);
/**
 * An agent's own token, launched and paid for by its owner from their own wallet: Argus on Arc (with the splitter its
 * creator fees accrue in) or Clanker v4 on Base. Recorded once the launch tx's receipt is checked (lib/launch/token.ts).
 */
export const vAgentToken = v.object({
  chain: v.union(v.literal("arc"), v.literal("base")),
  address: v.string(),
  splitter: v.optional(v.string()),
  launchTx: v.string(),
});

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
    chain,
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
    /** Linked markets (lib/chains/linked.ts): the same question opened by Mimir's agents on several chains share this. */
    pairKey: v.optional(v.string()),
    updatedBlock: v.number(),
  })
    .index("by_market", ["chain", "kind", "marketId"])
    .index("by_pair", ["pairKey"])
    .index("by_deadline", ["deadline"])
    .index("by_creator", ["creator"])
    // The oracle and the views read by state, oldest deadline first, instead of scanning every market.
    .index("by_status_deadline", ["status", "deadline"]),

  arcPositions: defineTable({
    chain,
    kind,
    marketId: v.number(),
    /** Lowercase Arc address (the user's wallet). */
    user: v.string(),
    side: v.number(),
    amount: v.string(),
    amountUsd: v.number(),
    /** Pool: the payout was collected (a Claimed event). VS pays at settlement, so it stays unset. */
    claimed: v.optional(v.boolean()),
  })
    .index("by_market", ["chain", "kind", "marketId"])
    .index("by_user", ["user"])
    .index("by_position", ["chain", "kind", "marketId", "user", "side"]),

  arcEvents: defineTable({
    chain,
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
    .index("by_market", ["chain", "kind", "marketId"])
    .index("by_user", ["user"])
    .index("by_name", ["name"]),

  /** The oracle's verdicts: the audit bundle whose sha256 went on chain as evidenceHash. */
  arcVerdicts: defineTable({
    chain,
    kind,
    marketId: v.number(),
    side: v.number(),
    /** The decided outcome before a per-market override (late stakes); absent on an uncontested refund. */
    decided: v.optional(v.number()),
    /** The decision's own summary when `summary` is an override's. */
    decidedSummary: v.optional(v.string()),
    /** The market's link (lib/chains/linked.ts): linked markets reuse the first decision. */
    pairKey: v.optional(v.string()),
    confidence: v.number(),
    summary: v.string(),
    evidenceHash: v.string(),
    bundle: v.string(),
    txHash: v.string(),
  }).index("by_market", ["chain", "kind", "marketId"]).index("by_pair", ["pairKey"]),

  /** A market Mimir's agents opened on several chains: one row per chain's market, the shared pairKey links them. */
  marketLinks: defineTable({
    pairKey: v.string(),
    chain: vChain,
    kind,
    marketId: v.number(),
    at: v.number(),
  }).index("by_market", ["chain", "kind", "marketId"]).index("by_pair", ["pairKey"]),

  /** Oracle backoff: a market whose decision was deferred (or failed) is not retried before `notBefore` (ms). */
  arcOracleTries: defineTable({
    chain,
    kind,
    marketId: v.number(),
    notBefore: v.number(),
    attempts: v.number(),
    lastError: v.optional(v.string()),
  }).index("by_market", ["chain", "kind", "marketId"]),

  /** Council persona decisions on Arc markets (convex/arcCouncil.ts); `until` (ms) is when the persona may look again. */
  arcCouncilDecisions: defineTable({
    slug: v.string(),
    chain,
    kind,
    marketId: v.number(),
    outcome: v.union(v.literal("staked"), v.literal("abstained"), v.literal("retry"), v.literal("failed")),
    rationale: v.string(),
    confidence: v.optional(v.number()),
    lean: v.optional(v.number()),
    amount: v.optional(v.string()),
    txHash: v.optional(v.string()),
    until: v.number(),
    at: v.number(),
  })
    .index("by_persona_market", ["slug", "chain", "kind", "marketId"])
    .index("by_market", ["chain", "kind", "marketId"])
    .index("by_until", ["until"]),

  /** One council take per market: the best-suited persona's read, no stake (convex/arcCouncil.ts, comment mode). */
  arcMarketTakes: defineTable({
    chain,
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
  }).index("by_market", ["chain", "kind", "marketId"]),

  /** One row per indexer (name = the chain id, "arc" or "base"): the last block fully applied. */
  arcCursor: defineTable({ name: v.string(), block: v.number() }).index("by_name", ["name"]),

  discoveryFollows: defineTable({ owner: v.string(), target: v.string(), at: v.number() }).index("by_owner", ["owner"]).index("by_owner_target", ["owner", "target"]),
  discoverySignals: defineTable({ marketChain: chain, marketKind: kind, marketId: v.number(), category: v.string(), slug: v.optional(v.string()),
    type: v.string(), text: v.string(), at: v.number() }).index("by_at", ["at"]),
  councilOpinions: defineTable({ chain, kind, marketId: v.number(), slug: v.string(), lean: v.number(), confidence: v.number(), text: v.string(), evidenceHash: v.string(), at: v.number() })
    .index("by_market", ["chain", "kind", "marketId"]).index("by_persona_market", ["slug", "chain", "kind", "marketId"]),
  councilForecastBudgets: defineTable({ creator: v.string(), day: v.string(), calls: v.number() }).index("by_creator", ["creator"]),

  /** Jev's triage of a new market (lib/jev-triage.ts, convex/arcTriage.ts); empty while TYPESAFE_API_KEY is unset. */
  arcTriage: defineTable({
    chain,
    kind,
    marketId: v.number(),
    resolvable: v.number(),
    spam: v.number(),
    category: v.string(),
    categoryConfidence: v.number(),
    at: v.number(),
  }).index("by_market", ["chain", "kind", "marketId"]),

  /** Admin panel (convex/arcAdmin.ts): when each scheduled job last started, one row per job. */
  arcHeartbeats: defineTable({ name: v.string(), at: v.number() }).index("by_name", ["name"]),

  /** Watchdog alerts already sent to the admin Telegram (convex/arcWatch.ts), so each problem is reported once per `until`. */
  arcAlerts: defineTable({ key: v.string(), until: v.number() }).index("by_key", ["key"]),

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

  /**
   * Mimir Launch (lib/launch): hosted agents. Free to create and live at once. Each stakes on Mimir markets from its Arc
   * wallet (Circle developer-controlled, funded by its owner in USDC; it pays its own gas) and may open its own markets.
   * It never trades tokens. Its optional token is launched by the owner's own wallet, so its fees go to the owner.
   * Market rules are validated in lib/launch before they are stored. A sealed own-key brain never leaves the server
   * (lib/launch/byok.ts).
   */
  launchAgents: defineTable({
    slug: v.string(),
    /** The owner's EVM address (checksummed): who created it, who withdrawals go to, who launches its token. */
    owner: v.string(),
    name: v.string(),
    ticker: v.string(),
    avatarSeed: v.string(),
    thesis: v.string(),
    status: v.union(v.literal("live"), v.literal("paused"), v.literal("killed")),
    brain: v.union(
      v.object({ kind: v.literal("mimir") }),
      v.object({ kind: v.literal("byok"), provider: v.string(), sealed: v.string(), last4: v.string(), model: v.string() }),
    ),
    /** Arc markets (lib/launch/markets MarketRules) and the most it may have staked at once, USDC. */
    markets: v.object({
      enabled: v.boolean(), rules: v.any(), budgetUsdc: v.number(),
      /** Opening its own markets (lib/launch/agent-markets.ts): off unless the owner turns it on; gas from its Arc wallet. */
      create: v.optional(v.object({ enabled: v.boolean(), perDay: v.number() })),
    }),
    arc: v.object({ walletId: v.string(), address: v.string() }),
    /**
     * Its Base wallet (Circle, blockchain BASE / BASE-SEPOLIA): stakes on Base markets. Pays gas in ETH, which the owner
     * or Mimir sends it (no gas station); made at creation when Base is enabled, else on first use (lib/launch/flow.ts).
     */
    base: v.optional(v.object({ walletId: v.string(), address: v.string() })),
    /** Its token, once its owner launched one (Argus on Arc or Clanker on Base). */
    token: v.optional(vAgentToken),
    /** Random id bound into the sealed BYOK key (lib/launch/byok AAD), fixed for the agent's life. */
    uid: v.string(),
    /** A council persona (agents/council): Mimir's own agent, its Arc wallet is the council's Circle wallet. */
    house: v.optional(v.string()),
    createdAt: v.number(),
    /** One spender per agent wallet (convex/launchAgentsDb.ts); when its market tick last ran. */
    leaseUntil: v.optional(v.number()),
    lastTickAt: v.optional(v.number()),
  })
    .index("by_slug", ["slug"])
    .index("by_owner", ["owner"])
    .index("by_status", ["status"])
    .index("by_token", ["token.address"]),

  /** What the agent did and why, newest last: the live reasoning log on its page. */
  launchEvents: defineTable({
    agent: v.id("launchAgents"),
    at: v.number(),
    kind: v.string(),
    text: v.string(),
    chain: v.optional(v.union(v.literal("arc"), v.literal("base"))),
    tx: v.optional(v.string()),
  }).index("by_agent", ["agent", "at"]),

  /** Mimir API (lib/launch/paid-call.ts): one row per payment tx ("<chain>:<tx>"), so a tx buys one call. */
  agentApiPayments: defineTable({
    key: v.string(),
    /** The agent's slug (a launched agent or a council persona). */
    agent: v.string(),
    units: v.string(),
    at: v.number(),
    /** Set once the agent answered; a claim without it is released when the call fails. */
    done: v.optional(v.boolean()),
  }).index("by_key", ["key"]).index("by_agent", ["agent", "at"]),

  /** Markets an agent opened on Mimir from its Arc wallet (its seed stake backs `side`). */
  launchMarkets: defineTable({
    agent: v.id("launchAgents"),
    /** The chain it opened on (absent = Arc, before Base). */
    chain,
    /** Set when the same draft was opened on several chains (lib/chains/linked.ts). */
    pairKey: v.optional(v.string()),
    at: v.number(),
    question: v.string(),
    category: v.string(),
    resolutionUrl: v.string(),
    deadline: v.number(),
    side: v.number(),
    seedUsdc: v.number(),
    tx: v.string(),
    why: v.string(),
  }).index("by_agent", ["agent", "at"]),

  /** Stakes on Mimir markets from the agent's Arc wallet. */
  launchStakes: defineTable({
    agent: v.id("launchAgents"),
    chain,
    kind: v.union(v.literal("vs"), v.literal("pool")),
    marketId: v.number(),
    side: v.number(),
    usdc: v.number(),
    p: v.number(),
    edge: v.number(),
    why: v.string(),
    tx: v.string(),
    at: v.number(),
  })
    .index("by_agent", ["agent", "at"])
    .index("by_market", ["chain", "kind", "marketId"]),

  /**
   * Copy staking (lib/launch/copy-stake.ts): one per (agent, follower). `agent` is a launch agent's or a council persona's
   * copy key (lib/launch/copy-key.ts). The follower's Circle copy wallet on Arc stakes the same side as the agent; a
   * stopped subscription takes no new stakes.
   */
  launchCopies: defineTable({
    agent: v.string(),
    follower: v.string(),
    arc: v.optional(v.object({ walletId: v.string(), address: v.string(), maxPerStakeUsdc: v.number(), on: v.boolean() })),
    /** The follower's Base copy wallet: copies of the leader's Base stakes go from here (ETH for gas, USDC). */
    base: v.optional(v.object({ walletId: v.string(), address: v.string(), maxPerStakeUsdc: v.number(), on: v.boolean() })),
    active: v.boolean(),
    pausedReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_agent", ["agent"])
    .index("by_agent_follower", ["agent", "follower"])
    .index("by_follower", ["follower"]),

  /** One follower's copy of one agent stake, keyed "<sub>:<chain>:<agent tx>": it runs once, on the leader's chain. */
  launchCopyJobs: defineTable({
    key: v.string(),
    chain,
    sub: v.id("launchCopies"),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("unknown"), v.literal("skipped")),
    note: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_status", ["status"])
    .index("by_sub", ["sub"]),
});
