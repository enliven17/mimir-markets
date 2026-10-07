// Arc indexer: pulls MimirV3 / MimirPool logs since the cursor, re-reads every market they touch from the chain
// (so contract logic is never re-implemented here) and hands the snapshots to arc.apply in one transaction.
// Arc has BFT finality (no reorgs), so a block once read is final. Runs from convex/crons.ts.
import { createPublicClient, http, parseAbi, parseEventLogs, type Log } from "viem";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { arcConfig } from "../lib/arc/config";

const V3_ABI = parseAbi([
  "event ClaimCreated(uint256 indexed id, address indexed creator, string category)",
  "event ClaimChallenged(uint256 indexed id, address indexed challenger, uint256 stake)",
  "event ClaimResolved(uint256 indexed id, uint8 winnerSide, string summary, uint8 confidence, bytes32 evidenceHash)",
  "event ClaimCancelled(uint256 indexed id)",
  "event ResolutionProposed(uint256 indexed id, uint8 winnerSide, uint8 confidence, bytes32 evidenceHash, uint256 disputableUntil)",
  "event ResolutionDisputed(uint256 indexed id, address indexed disputer, uint256 bond)",
  "event DisputeResolved(uint256 indexed id, uint8 winnerSide, bool disputerRight)",
  "event MarketSettled(uint256 indexed id, uint256 totalPaid, uint256 totalFees)",
  "event ClaimExpiredRefund(uint256 indexed id, address indexed caller)",
  "event ReferrerSet(uint256 indexed id, address indexed participant, address indexed referrer)",
  "event FeeAccrued(uint256 indexed id, address indexed recipient, uint256 amount)",
  "function getClaim(uint256) view returns (address creator, string question, string creatorPosition, string counterPosition, string resolutionUrl, uint256 creatorStake, uint256 totalChallengerStake, uint256 reservedCreatorLiability, uint256 deadline, uint8 state, uint8 winnerSide, string resolutionSummary, uint8 confidence, string category, uint256 parentId, uint256 challengerCount, uint256 createdAt, bytes32 evidenceHash)",
  "function getClaimMarketConfig(uint256) view returns (string marketType, string oddsMode, uint256 challengerPayoutBps, string handicapLine, string settlementRule, uint256 maxChallengers, bool isPrivate, uint256 reservedCreatorLiability)",
  "function getChallengerList(uint256) view returns (address[] addrs, uint256[] stakes)",
  "function disputeWindow() view returns (uint256)",
  "function proposals(uint256) view returns (uint8 winnerSide, uint8 confidence, uint64 proposedAt, uint64 disputedAt, address disputer, uint256 bond, bytes32 evidenceHash, string summary)",
]);
const POOL_ABI = parseAbi([
  "event MarketCreated(uint256 indexed id, address indexed creator, uint256 deadline, string category)",
  "event Staked(uint256 indexed id, address indexed user, uint8 side, uint256 amount)",
  "event ResolutionProposed(uint256 indexed id, uint8 outcome, bytes32 evidenceHash, uint256 disputableUntil)",
  "event ResolutionDisputed(uint256 indexed id, address indexed disputer, uint256 bond)",
  "event DisputeResolved(uint256 indexed id, uint8 outcome, bool disputerRight)",
  "event MarketResolved(uint256 indexed id, uint8 outcome, string summary, bytes32 evidenceHash)",
  "event MarketExpiredRefund(uint256 indexed id, address indexed caller)",
  "event Claimed(uint256 indexed id, address indexed user, uint256 paid, uint256 fee)",
  "event ReferrerSet(uint256 indexed id, address indexed user, address indexed referrer)",
  "event FeeAccrued(uint256 indexed id, address indexed recipient, uint256 amount)",
  "function getMarket(uint256) view returns (address creator, uint256 deadline, uint256 createdAt, uint8 state, uint8 outcome, uint256 totalA, uint256 totalB)",
  "function getMarketText(uint256) view returns (string question, string labelA, string labelB, string resolutionUrl, string category, string summary)",
  "function stakeOf(uint256, address) view returns (uint256 onA, uint256 onB)",
  "function disputeWindow() view returns (uint256)",
  "function getProposal(uint256) view returns (uint8 proposed, uint256 proposedAt, uint256 disputedAt, address disputer, uint256 bond, bytes32 evidenceHash)",
]);

const V3_STATUS = ["open", "active", "resolved", "cancelled", "proposed", "disputed"] as const;
const POOL_STATUS = ["open", "proposed", "disputed", "resolved"] as const;
// The public Arc RPC refuses eth_getLogs ranges of a few hundred blocks ("requested range too large"); ~0.5 s blocks,
// so 30 s of cron is ~60 blocks. ponytail: fixed chunk and per-run cap; a private RPC can take bigger ranges.
const CHUNK = 250n;
const MAX_CHUNKS = 40;
const usd = (wei: bigint) => Number(wei) / 1e18;
/** Both contracts: refundExpired opens this long after the deadline (or the dispute). */
const RESOLUTION_GRACE_SECONDS = 7 * 86_400;
/** Proposal timing: when the dispute window closes (0 = no proposal) and when the refund escape hatch opens. */
function timing(deadline: bigint, proposedAt: bigint, disputedAt: bigint, window: bigint) {
  return {
    disputableUntil: proposedAt > 0n ? Number(proposedAt + window) : 0,
    refundAt: Number((disputedAt > deadline ? disputedAt : deadline) + BigInt(RESOLUTION_GRACE_SECONDS)),
  };
}
const lower = (a: string) => a.toLowerCase();

type Kind = "vs" | "pool";
type DecodedLog = Log<bigint, number, false> & { eventName: string; args: Record<string, unknown> };

function config() {
  const e = process.env;
  return arcConfig({
    network: e.ARC_NETWORK,
    rpcUrl: e.ARC_RPC,
    mimirV3: e.MIMIR_V3_ADDRESS,
    mimirPool: e.MIMIR_POOL_ADDRESS,
    fromBlock: e.MIMIR_ARC_FROM_BLOCK,
  });
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const cfg = config();
    const { mimirV3, mimirPool, fromBlock } = cfg.contracts;
    if (!mimirV3 || !mimirPool) throw new Error("MIMIR_V3_ADDRESS and MIMIR_POOL_ADDRESS must be set in the Convex env");
    const client = createPublicClient({ transport: http(cfg.chain.rpcUrl) });

    const cursor = await ctx.runQuery(internal.arc.cursor, {});
    let from = cursor === null ? fromBlock : BigInt(cursor) + 1n;
    const head = await client.getBlockNumber();
    const [v3Window, poolWindow] = await Promise.all([
      client.readContract({ address: mimirV3, abi: V3_ABI, functionName: "disputeWindow" }),
      client.readContract({ address: mimirPool, abi: POOL_ABI, functionName: "disputeWindow" }),
    ]);
    for (let i = 0; i < MAX_CHUNKS && from <= head; i++) {
      const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
      // No topic filter: the RPC's range limit is far lower with one, so take every log and keep the known events.
      const [v3Raw, poolRaw] = await Promise.all([
        client.getLogs({ address: mimirV3, fromBlock: from, toBlock: to }),
        client.getLogs({ address: mimirPool, fromBlock: from, toBlock: to }),
      ]);
      const v3Logs = parseEventLogs({ abi: V3_ABI, logs: v3Raw, strict: false });
      const poolLogs = parseEventLogs({ abi: POOL_ABI, logs: poolRaw, strict: false });
      const logs = [
        ...v3Logs.map((l) => ({ kind: "vs" as Kind, log: l as unknown as DecodedLog })),
        ...poolLogs.map((l) => ({ kind: "pool" as Kind, log: l as unknown as DecodedLog })),
      ];

      const touched = new Map<string, { kind: Kind; id: bigint; users: Set<string> }>();
      for (const { kind, log } of logs) {
        const id = log.args.id as bigint;
        const key = `${kind}:${id}`;
        const t = touched.get(key) ?? { kind, id, users: new Set<string>() };
        if (log.eventName === "Staked") t.users.add(log.args.user as string);
        touched.set(key, t);
      }

      const markets = [];
      const positions = [];
      for (const t of touched.values()) {
        const snap = t.kind === "vs"
          ? await readVs(client, mimirV3, t.id, Number(to), v3Window)
          : await readPool(client, mimirPool, t.id, [...t.users], Number(to), poolWindow);
        markets.push(snap.market);
        positions.push(...snap.positions);
      }

      // Block times for the activity feed: one read per block that has a log.
      const times = new Map<bigint, number>();
      for (const b of new Set(logs.map(({ log }) => log.blockNumber))) {
        times.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp));
      }

      const changes = await ctx.runMutation(internal.arc.apply, {
        name: "arc",
        block: Number(to),
        markets,
        positions,
        events: logs.map(({ kind, log }) => ({ ...eventRow(kind, log), at: times.get(log.blockNumber) })),
      });
      await notifyTelegram(ctx, changes);
      from = to + 1n;
    }
  },
});

type Client = ReturnType<typeof createPublicClient>;

async function readVs(client: Client, address: `0x${string}`, id: bigint, block: number, window: bigint) {
  const [c, cfg, list, proposal] = await Promise.all([
    client.readContract({ address, abi: V3_ABI, functionName: "getClaim", args: [id] }),
    client.readContract({ address, abi: V3_ABI, functionName: "getClaimMarketConfig", args: [id] }),
    client.readContract({ address, abi: V3_ABI, functionName: "getChallengerList", args: [id] }),
    client.readContract({ address, abi: V3_ABI, functionName: "proposals", args: [id] }),
  ]);
  const [creator, question, creatorPosition, counterPosition, resolutionUrl, creatorStake, totalChallengerStake, , deadline, state, winnerSide, summary, , category, , , createdAt] = c;
  const byUser = new Map<string, bigint>();
  list[0].forEach((a, i) => byUser.set(lower(a), (byUser.get(lower(a)) ?? 0n) + list[1][i]));
  const positions = [
    { kind: "vs" as const, marketId: Number(id), user: lower(creator), side: 1, amount: creatorStake.toString(), amountUsd: usd(creatorStake) },
    ...[...byUser].map(([user, amount]) => ({ kind: "vs" as const, marketId: Number(id), user, side: 2, amount: amount.toString(), amountUsd: usd(amount) })),
  ];
  return {
    market: {
      kind: "vs" as const,
      marketId: Number(id),
      creator: lower(creator),
      question,
      labelA: creatorPosition,
      labelB: counterPosition,
      resolutionUrl,
      category,
      deadline: Number(deadline),
      createdAt: Number(createdAt),
      status: V3_STATUS[state] ?? "open",
      winner: winnerSide,
      summary,
      stakeA: creatorStake.toString(),
      stakeB: totalChallengerStake.toString(),
      volumeUsd: usd(creatorStake + totalChallengerStake),
      participants: 1 + byUser.size,
      isPrivate: cfg[6],
      ...timing(deadline, BigInt(proposal[2]), BigInt(proposal[3]), window),
      updatedBlock: block,
    },
    positions,
  };
}

async function readPool(client: Client, address: `0x${string}`, id: bigint, users: string[], block: number, window: bigint) {
  const [m, text, proposal] = await Promise.all([
    client.readContract({ address, abi: POOL_ABI, functionName: "getMarket", args: [id] }),
    client.readContract({ address, abi: POOL_ABI, functionName: "getMarketText", args: [id] }),
    client.readContract({ address, abi: POOL_ABI, functionName: "getProposal", args: [id] }),
  ]);
  const [creator, deadline, createdAt, state, outcome, totalA, totalB] = m;
  const [question, labelA, labelB, resolutionUrl, category, summary] = text;
  const positions = [];
  for (const u of users) {
    const [onA, onB] = await client.readContract({ address, abi: POOL_ABI, functionName: "stakeOf", args: [id, u as `0x${string}`] });
    for (const [side, amount] of [[1, onA], [2, onB]] as const) {
      if (amount > 0n) positions.push({ kind: "pool" as const, marketId: Number(id), user: lower(u), side, amount: amount.toString(), amountUsd: usd(amount) });
    }
  }
  return {
    market: {
      kind: "pool" as const,
      marketId: Number(id),
      creator: lower(creator),
      question,
      labelA,
      labelB,
      resolutionUrl,
      category,
      deadline: Number(deadline),
      createdAt: Number(createdAt),
      // An expired refund resolves the market as unresolvable (outcome 4): shown as cancelled.
      status: state === 3 && outcome === 4 ? ("cancelled" as const) : (POOL_STATUS[state] ?? "open"),
      winner: outcome,
      summary,
      stakeA: totalA.toString(),
      stakeB: totalB.toString(),
      volumeUsd: usd(totalA + totalB),
      // ponytail: participants is filled from the positions table in arc.apply (no on-chain count for pools).
      participants: 0,
      isPrivate: false,
      ...timing(deadline, proposal[1], proposal[2], window),
      updatedBlock: block,
    },
    positions,
  };
}

function eventRow(kind: Kind, log: DecodedLog) {
  const a = log.args;
  const user = (a.challenger ?? a.creator ?? a.user ?? a.participant ?? a.recipient ?? a.disputer ?? a.caller) as string | undefined;
  const amount = (a.stake ?? a.amount ?? a.paid ?? a.bond ?? a.totalPaid) as bigint | undefined;
  const side = (a.side ?? a.winnerSide ?? a.outcome) as number | undefined;
  return {
    kind,
    marketId: Number(a.id as bigint),
    name: log.eventName,
    user: user ? lower(user) : undefined,
    amount: amount?.toString(),
    side: side === undefined ? undefined : Number(side),
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    block: Number(log.blockNumber),
  };
}

type Change = { type: "new" | "proposed" | "resolved" | "cancelled"; kind: Kind; marketId: number };

/**
 * Post what changed to the site's Telegram route (app/api/telegram/arc-events), which messages the chats. Off unless
 * TELEGRAM_EVENTS_URL and MIMIR_INTERNAL_SECRET are set; a failed post is logged, never retried (alerts are best effort).
 * "New" only for markets opened in the last hour, so a re-index does not announce old markets again.
 */
async function notifyTelegram(ctx: ActionCtx, changes: Change[]): Promise<void> {
  const url = process.env.TELEGRAM_EVENTS_URL?.trim();
  const secret = process.env.MIMIR_INTERNAL_SECRET?.trim();
  if (!url || !secret || !changes.length) return;
  const recent = Math.floor(Date.now() / 1000) - 3600;
  const events = [];
  for (const c of changes) {
    const m = await ctx.runQuery(internal.arc.marketWithPositions, { kind: c.kind, marketId: c.marketId });
    if (!m || m.isPrivate || (c.type === "new" && m.createdAt < recent)) continue;
    const holders = c.type === "cancelled" ? [{ user: m.creator, side: 1 }] : m.positions.map((p) => ({ user: p.user, side: p.side }));
    events.push({
      type: c.type,
      kind: m.kind,
      marketId: m.marketId,
      question: m.question,
      labelA: m.labelA,
      labelB: m.labelB,
      stakeA: m.stakeA,
      deadline: m.deadline,
      winner: m.winner,
      summary: m.summary,
      disputableUntil: m.disputableUntil,
      holders,
    });
  }
  if (!events.length) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) console.warn(`[telegram] arc-events ${res.status}`);
  } catch (err) {
    console.warn("[telegram] arc-events post failed:", err instanceof Error ? err.message : err);
  }
}
