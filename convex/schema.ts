import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The Arc markets as indexed from MimirV3 (kind "vs") and MimirPool (kind "pool") by convex/arcSync.ts.
// Amounts are wei strings (18 dp native USDC overflows int64 past ~9.2 USDC); the *Usd floats are for sorting and display.
const kind = v.union(v.literal("vs"), v.literal("pool"));
/** Mimir Launch: the owner's split of an agent's creator fees (lib/launch/fees.ts), whole percents summing to 100. */
export const vAllocation = v.object({ bankroll: v.number(), buyback: v.number(), creatorPayout: v.number(), holders: v.number() });

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
   * Mimir Launch (lib/launch): hosted agents. Each holds a Solana wallet (Privy, policy-locked: trades and its own
   * pump.fun token) and an Arc wallet (Circle developer-controlled: stakes on Mimir markets); each pays its own gas.
   * Strategy, risk and market rules are validated in lib/launch before they are stored, so they are kept as plain
   * objects here. A sealed own-key brain never leaves the server (lib/launch/byok.ts).
   */
  launchAgents: defineTable({
    slug: v.string(),
    /** The owner's Solana wallet (base58): who launched it, who withdrawals go to. */
    owner: v.string(),
    name: v.string(),
    ticker: v.string(),
    avatarSeed: v.string(),
    thesis: v.string(),
    status: v.union(v.literal("pending"), v.literal("live"), v.literal("paused"), v.literal("killed")),
    brain: v.union(
      v.object({ kind: v.literal("mimir") }),
      v.object({ kind: v.literal("byok"), provider: v.string(), sealed: v.string(), last4: v.string(), model: v.string() }),
    ),
    /** Solana trading: off unless the owner turns it on with a strategy (lib/launch/types StrategyConfig + RiskParams). */
    trading: v.object({ enabled: v.boolean(), config: v.any(), risk: v.any() }),
    /** Arc markets (lib/launch/markets MarketRules) and the most it may have staked at once, USDC. */
    markets: v.object({
      enabled: v.boolean(), rules: v.any(), budgetUsdc: v.number(),
      /** Opening its own markets (lib/launch/agent-markets.ts): off unless the owner turns it on; gas from its Arc wallet. */
      create: v.optional(v.object({ enabled: v.boolean(), perDay: v.number() })),
    }),
    solana: v.optional(v.object({ walletId: v.string(), address: v.string() })),
    arc: v.optional(v.object({ walletId: v.string(), address: v.string() })),
    /** Its pump.fun token, once launched. */
    mint: v.optional(v.string()),
    /** Its Argus token on Arc (lib/launch/argus.ts), once launched; such an agent has no `mint`. */
    token: v.optional(v.object({
      chain: v.literal("arc"), address: v.string(), poolId: v.string(), splitter: v.string(), hook: v.string(), locker: v.string(),
      creatorBps: v.number(), tx: v.optional(v.string()),
    })),
    /**
     * Its Argus fee ledger in USDC6 (decimal strings): claimed from the splitter, Mimir's 20% owed and paid to the treasury,
     * and the one Circle tx in flight, recorded before it is waited on so an unconfirmed send is settled, never repeated.
     */
    argusFees: v.optional(v.object({
      claimed6: v.string(), owedTreasury6: v.string(), paidTreasury6: v.string(), lastRoundAt: v.number(),
      pending: v.optional(v.object({ step: v.union(v.literal("claim"), v.literal("treasury")), circleId: v.string(), amount6: v.string(), at: v.number() })),
    })),
    /** Random id bound into the sealed BYOK key (lib/launch/byok AAD), fixed for the agent's life. */
    uid: v.string(),
    /** A council persona (agents/council): Mimir's own agent, its Arc wallet is the council's Circle wallet. */
    house: v.optional(v.string()),
    /** The launch: SOL the owner must send (lamports, decimal string), the token text, and the claim that lets one request mint. */
    launch: v.optional(v.object({
      fundLamports: v.string(),
      description: v.string(),
      /** Where its token launches: pump.fun on Solana (the default) or Argus on Arc, with the Argus taxes. */
      chain: v.optional(v.union(v.literal("solana"), v.literal("arc"))),
      argus: v.optional(v.object({ buyTaxBps: v.number(), sellTaxBps: v.number() })),
      /** An uploaded token image (data URL, capped well under the doc limit); without one the face is drawn at launch. */
      image: v.optional(v.string()),
      claimedAt: v.optional(v.number()),
      metadataUri: v.optional(v.string()),
      sig: v.optional(v.string()),
    })),
    /** The verified funding tx, bound to this agent so it cannot fund another launch. */
    fundingSig: v.optional(v.string()),
    createdAt: v.number(),
    /** One worker at a time per agent (snipad's lease); and a sleeping agent is skipped until then. */
    leaseUntil: v.optional(v.number()),
    sleepUntil: v.optional(v.number()),
    lastTickAt: v.optional(v.number()),
    /** Solana tick: idle/sleep bookkeeping (lib/launch/worker/idle.ts) and when a shut-down agent's SOL went back. */
    idle: v.optional(v.object({ ticks: v.number(), sleepingSince: v.optional(v.number()), checkedAt: v.optional(v.number()), wakeRequestedAt: v.optional(v.number()) })),
    sweptAt: v.optional(v.number()),
    /**
     * Creator fees (lib/launch/fees.ts): the owner's split of its 80% (whole percents summing to 100), a pending
     * change that applies 24 h after it was asked for, and the two pools owed out of the wallet (never traded).
     */
    allocation: v.optional(vAllocation),
    pendingAllocation: v.optional(v.object({ allocation: vAllocation, effectiveAt: v.number(), requestedAt: v.number() })),
    creatorPool: v.optional(v.int64()),
    holdersPool: v.optional(v.int64()),
    feesClaimedAt: v.optional(v.number()),
    /** A fee claim signed but not booked yet (its sig stored before broadcast): settled and booked on the next round. */
    pendingClaim: v.optional(v.object({ sig: v.string(), lastValidBlockHeight: v.number() })),
    holdersAirdropAt: v.optional(v.number()),
    /** True while the wallet policy may be widened for a holder airdrop round (restored after). */
    airdropPolicyOpen: v.optional(v.boolean()),
  })
    .index("by_slug", ["slug"])
    .index("by_owner", ["owner"])
    .index("by_status", ["status"])
    .index("by_fundingSig", ["fundingSig"]),

  /** What the agent did and why, newest last: the live reasoning log on its page. */
  launchEvents: defineTable({
    agent: v.id("launchAgents"),
    at: v.number(),
    kind: v.string(),
    text: v.string(),
    chain: v.optional(v.union(v.literal("solana"), v.literal("arc"))),
    tx: v.optional(v.string()),
  }).index("by_agent", ["agent", "at"]),

  /** Open Solana token positions (one per mint). */
  launchPositions: defineTable({
    agent: v.id("launchAgents"),
    mint: v.string(),
    symbol: v.string(),
    tokens: v.string(),
    costLamports: v.string(),
    entryPriceSol: v.number(),
    peakPriceSol: v.number(),
    openedAt: v.number(),
    decimals: v.optional(v.number()),
  }).index("by_agent", ["agent"]),

  /** Every Solana buy and sell, with its signature (unconfirmed ones are settled by a reconciler). */
  launchTrades: defineTable({
    agent: v.id("launchAgents"),
    mint: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    lamports: v.string(),
    tokens: v.string(),
    sig: v.string(),
    status: v.union(v.literal("pending"), v.literal("confirmed"), v.literal("failed")),
    pnlLamports: v.optional(v.string()),
    reason: v.string(),
    at: v.number(),
  })
    .index("by_agent", ["agent", "at"])
    .index("by_sig", ["sig"]),

  /** Markets an agent opened on Mimir from its Arc wallet (its seed stake backs `side`). */
  launchMarkets: defineTable({
    agent: v.id("launchAgents"),
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
    .index("by_market", ["kind", "marketId"]),

  /**
   * Copy trading (lib/launch/worker/copy.ts): one per (agent, follower). `agent` is a launch agent's slug or a council
   * persona's slug. Each side the follower picked has its own copy wallet; a stopped or gated subscription takes no
   * new entries, but what it holds still exits with the agent.
   */
  launchCopies: defineTable({
    agent: v.string(),
    follower: v.string(),
    solana: v.optional(v.object({ walletId: v.string(), address: v.string(), maxPerTradeLamports: v.string(), on: v.boolean() })),
    arc: v.optional(v.object({ walletId: v.string(), address: v.string(), maxPerStakeUsdc: v.number(), on: v.boolean() })),
    active: v.boolean(),
    pausedReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_agent", ["agent"])
    .index("by_agent_follower", ["agent", "follower"])
    .index("by_follower", ["follower"]),

  /** Tokens a Solana copy wallet holds because it mirrored a buy (so its sells follow the agent's). */
  launchCopyPositions: defineTable({
    sub: v.id("launchCopies"),
    mint: v.string(),
    tokens: v.string(),
    costLamports: v.string(),
  })
    .index("by_sub", ["sub"])
    .index("by_sub_mint", ["sub", "mint"]),

  /**
   * One follower's copy of one agent fill (lib/launch/worker/copy.ts), keyed "<sub>:<buy|sell|arc>:<agent sig>": it
   * runs once. A Solana buy stores its own sig before broadcast; "unknown" ones are settled by signature.
   */
  launchCopyJobs: defineTable({
    key: v.string(),
    sub: v.id("launchCopies"),
    kind: v.union(v.literal("buy"), v.literal("sell"), v.literal("arc")),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("unknown"), v.literal("skipped")),
    mint: v.optional(v.string()),
    sig: v.optional(v.string()),
    lastValidBlockHeight: v.optional(v.number()),
    note: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_status", ["status"])
    .index("by_sub", ["sub"]),
  // ---------------- Mimir Launch creator fees (lib/launch/fees.ts, airdrop.ts; convex/launchFeeDb.ts) ----------------

  /** Every creator-fee claim, once per signature, with the split it was booked with. */
  launchFeeClaims: defineTable({
    agent: v.id("launchAgents"),
    lamports: v.int64(),
    split: v.object({ platform: v.int64(), llm: v.int64(), bankroll: v.int64(), buyback: v.int64(), creatorPayout: v.int64(), holders: v.int64() }),
    allocation: vAllocation,
    sig: v.string(),
    at: v.number(),
  })
    .index("by_sig", ["sig"])
    .index("by_agent", ["agent", "at"]),

  /** The platform + AI share of a claim, owed to the treasury and paid from this record (its sig stored before broadcast). */
  launchTreasuryTransfers: defineTable({
    agent: v.id("launchAgents"),
    claimSig: v.string(),
    lamports: v.int64(),
    status: v.union(v.literal("pending"), v.literal("sending"), v.literal("sent"), v.literal("unknown")),
    sig: v.optional(v.string()),
    lastValidBlockHeight: v.optional(v.number()),
    at: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_agent_status", ["agent", "status"])
    .index("by_status", ["status"]),

  /** Owner payouts from the creator pool: reserved first, sig stored before broadcast, so one is never paid twice. */
  launchPayouts: defineTable({
    agent: v.id("launchAgents"),
    lamports: v.int64(),
    status: v.union(v.literal("sending"), v.literal("sent"), v.literal("failed"), v.literal("unknown")),
    sig: v.optional(v.string()),
    lastValidBlockHeight: v.optional(v.number()),
    at: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_agent", ["agent", "at"])
    .index("by_agent_status", ["agent", "status"])
    .index("by_status", ["status"]),

  /** Buybacks of the agent's own token, burned. */
  launchBurns: defineTable({
    agent: v.id("launchAgents"),
    mint: v.string(),
    lamports: v.int64(),
    tokens: v.int64(),
    buySig: v.string(),
    burnSig: v.string(),
    at: v.number(),
  })
    .index("by_burnSig", ["burnSig"])
    .index("by_agent", ["agent", "at"]),

  /** A holder airdrop round: its total reserved from the holders pool in the write that plans it. */
  launchHolderRounds: defineTable({
    agent: v.id("launchAgents"),
    total: v.int64(),
    recipients: v.number(),
    status: v.union(v.literal("paying"), v.literal("done")),
    at: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_agent", ["agent", "at"])
    .index("by_status", ["status"]),

  launchHolderBatches: defineTable({
    round: v.id("launchHolderRounds"),
    agent: v.id("launchAgents"),
    idx: v.number(),
    transfers: v.array(v.object({ to: v.string(), lamports: v.int64() })),
    status: v.union(v.literal("planned"), v.literal("sending"), v.literal("sent"), v.literal("failed")),
    sig: v.optional(v.string()),
    lastValidBlockHeight: v.optional(v.number()),
    attempts: v.optional(v.number()),
  }).index("by_round", ["round"]),

  /** Periodic holder balances: a round pays the smaller of now and a random earlier snapshot (anti-sniping). */
  launchHolderSnapshots: defineTable({
    agent: v.id("launchAgents"),
    at: v.number(),
    balances: v.array(v.object({ owner: v.string(), amount: v.int64() })),
  }).index("by_agent_at", ["agent", "at"]),
});
