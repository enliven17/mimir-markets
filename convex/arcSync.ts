// The market indexer, one run per chain (convex/crons.ts: "arc" and "base"): pulls MimirV3 / MimirPool logs since
// that chain's cursor, re-reads every market they touch from the chain (so contract logic is never re-implemented
// here) and hands the snapshots to arc.apply in one transaction. The Base contracts (MimirV3Erc20, MimirPoolErc20)
// keep the Arc contracts' views and events, so one decoder serves both; Base's 6-dp amounts are scaled to the 18-dp
// index unit on the way in (readVs / readPool below, eventRow in lib/chains/indexer.ts).
// Finality: Arc is BFT (a block once read is final). Base is an OP-stack rollup whose sequencer blocks reorg only in
// rare incidents: the indexer stays BASE_CONFIRMATIONS blocks behind its head (default 6, ~12 s).
// A chain without both market contracts in the Convex env is disabled: its run returns at once.
import { internalSecret } from "../lib/internal-secrets";
import { createPublicClient, parseEventLogs } from "viem";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { chainTransport } from "../lib/chains/client";
import { serverMarketChains, type MarketChain, type MarketChainId } from "../lib/chains/registry";
import { indexToUsd, toIndexUnits } from "../lib/chains/amounts";
import { eventRow, lower, POOL_ABI, V3_ABI, ZERO_ADDRESS, type DecodedLog, type Kind } from "../lib/chains/indexer";
import { jevEnabled } from "../lib/jev";
import { triageMarket } from "../lib/jev-triage";
import { vChain } from "./schema";

const V3_STATUS = ["open", "active", "resolved", "cancelled", "proposed", "disputed"] as const;
const POOL_STATUS = ["open", "proposed", "disputed", "resolved"] as const;
// The public Arc RPC refuses eth_getLogs ranges of a few hundred blocks ("requested range too large"); ~0.5 s blocks,
// so 30 s of cron is ~60 blocks. Base: 2 s blocks; sepolia.base.org limits eth_getLogs to 200 blocks.
// ponytail: fixed chunk and per-run cap; a private RPC can take bigger ranges.
const CHUNK: Record<MarketChainId, bigint> = { arc: 250n, base: 200n };
const MAX_CHUNKS = 40;
/** Blocks the Base indexer stays behind its head (reorg margin). */
const confirmations = (chain: MarketChainId) => (chain === "base" ? BigInt(Number(process.env.BASE_CONFIRMATIONS ?? 6) || 0) : 0n);
/** Both contracts: refundExpired opens this long after the deadline (or the dispute). */
const RESOLUTION_GRACE_SECONDS = 7 * 86_400;
/** Proposal timing: when the dispute window closes (0 = no proposal) and when the refund escape hatch opens. */
function timing(deadline: bigint, proposedAt: bigint, disputedAt: bigint, window: bigint) {
  return {
    disputableUntil: proposedAt > 0n ? Number(proposedAt + window) : 0,
    refundAt: Number((disputedAt > deadline ? disputedAt : deadline) + BigInt(RESOLUTION_GRACE_SECONDS)),
  };
}
/** The owner's veto is a dispute with no disputer (vetoProposal). */
const vetoed = (status: string, disputer: string) => status === "disputed" && lower(disputer) === ZERO_ADDRESS;

export const sync = internalAction({
  args: { chain: v.optional(vChain) },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.marketDeployment.check, {});
    if (process.env.MIMIR_BACKEND_OFF === "1") return; // this deployment is switched off (crons.ts)
    const chainId: MarketChainId = args.chain ?? "arc";
    const cfg = serverMarketChains().chains[chainId];
    if (!cfg.enabled) return; // not configured (or not in MARKET_CHAINS) on this deployment
    await ctx.runMutation(internal.arcAdmin.beat, { name: `${chainId}-sync` });
    // Rows from before Base carry no chain: tag them "arc" first (cheap once done).
    if (chainId === "arc") await ctx.runMutation(internal.chainMigrate.run, {});
    const { mimirV3, mimirPool, fromBlock } = cfg.contracts as { mimirV3: `0x${string}`; mimirPool: `0x${string}`; fromBlock: bigint };
    const client = createPublicClient({ transport: chainTransport(cfg) });

    const cursor = await ctx.runQuery(internal.arc.cursor, { name: chainId });
    let from = cursor === null ? fromBlock : BigInt(cursor) + 1n;
    const head = (await client.getBlockNumber()) - confirmations(chainId);
    const [v3Window, poolWindow] = await Promise.all([
      client.readContract({ address: mimirV3, abi: V3_ABI, functionName: "disputeWindow" }),
      client.readContract({ address: mimirPool, abi: POOL_ABI, functionName: "disputeWindow" }),
    ]);
    for (let i = 0; i < MAX_CHUNKS && from <= head; i++) {
      const to = from + CHUNK[chainId] - 1n < head ? from + CHUNK[chainId] - 1n : head;
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
          ? await readVs(cfg, client, mimirV3, t.id, Number(to), v3Window)
          : await readPool(cfg, client, mimirPool, t.id, [...t.users], Number(to), poolWindow);
        markets.push(snap.market);
        positions.push(...snap.positions);
      }

      // Block times for the activity feed: one read per block that has a log.
      const times = new Map<bigint, number>();
      for (const b of new Set(logs.map(({ log }) => log.blockNumber))) {
        times.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp));
      }

      const changes = await ctx.runMutation(internal.arc.apply, {
        name: chainId,
        block: Number(to),
        markets,
        positions,
        events: logs.map(({ kind, log }) => ({ ...eventRow(cfg, kind, log), at: times.get(log.blockNumber) })),
      });
      await notifyTelegram(ctx, changes);
      await triageNew(ctx, changes);
      from = to + 1n;
    }
  },
});

type Client = ReturnType<typeof createPublicClient>;

/** The chain's raw on-chain amount (wei on Arc, 6-dp units on Base) in index units. */
const idx = (cfg: Pick<MarketChain, "usdc">, raw: bigint) => toIndexUnits(cfg, raw);

async function readVs(chain: Pick<MarketChain, "id" | "usdc">, client: Client, address: `0x${string}`, id: bigint, block: number, window: bigint) {
  const [c, cfg, list, proposal, lock] = await Promise.all([
    client.readContract({ address, abi: V3_ABI, functionName: "getClaim", args: [id] }),
    client.readContract({ address, abi: V3_ABI, functionName: "getClaimMarketConfig", args: [id] }),
    client.readContract({ address, abi: V3_ABI, functionName: "getChallengerList", args: [id] }),
    client.readContract({ address, abi: V3_ABI, functionName: "proposals", args: [id] }),
    client.readContract({ address, abi: V3_ABI, functionName: "lockAt", args: [id] }).catch(() => 0n), // contracts before the cutover have no lockAt
  ]);
  const [creator, question, creatorPosition, counterPosition, resolutionUrl, rawCreatorStake, rawChallengerStake, , deadline, state, winnerSide, summary, , category, , , createdAt] = c;
  const creatorStake = idx(chain, rawCreatorStake);
  const totalChallengerStake = idx(chain, rawChallengerStake);
  const byUser = new Map<string, bigint>();
  list[0].forEach((a, i) => byUser.set(lower(a), (byUser.get(lower(a)) ?? 0n) + idx(chain, list[1][i])));
  const positions = [
    { chain: chain.id, kind: "vs" as const, marketId: Number(id), user: lower(creator), side: 1, amount: creatorStake.toString(), amountUsd: indexToUsd(creatorStake) },
    ...[...byUser].map(([user, amount]) => ({ chain: chain.id, kind: "vs" as const, marketId: Number(id), user, side: 2, amount: amount.toString(), amountUsd: indexToUsd(amount) })),
  ];
  return {
    market: {
      chain: chain.id,
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
      lockAt: Number(lock),
      vetoed: vetoed(V3_STATUS[state] ?? "open", proposal[4]),
      winner: winnerSide,
      summary,
      stakeA: creatorStake.toString(),
      stakeB: totalChallengerStake.toString(),
      volumeUsd: indexToUsd(creatorStake + totalChallengerStake),
      participants: 1 + byUser.size,
      isPrivate: cfg[6],
      ...timing(deadline, BigInt(proposal[2]), BigInt(proposal[3]), window),
      updatedBlock: block,
    },
    positions,
  };
}

async function readPool(cfg: Pick<MarketChain, "id" | "usdc">, client: Client, address: `0x${string}`, id: bigint, users: string[], block: number, window: bigint) {
  const [m, text, proposal, lock] = await Promise.all([
    client.readContract({ address, abi: POOL_ABI, functionName: "getMarket", args: [id] }),
    client.readContract({ address, abi: POOL_ABI, functionName: "getMarketText", args: [id] }),
    client.readContract({ address, abi: POOL_ABI, functionName: "getProposal", args: [id] }),
    client.readContract({ address, abi: POOL_ABI, functionName: "lockAt", args: [id] }).catch(() => 0n), // contracts before the cutover have no lockAt
  ]);
  const [creator, deadline, createdAt, state, outcome, rawA, rawB] = m;
  const totalA = idx(cfg, rawA);
  const totalB = idx(cfg, rawB);
  const [question, labelA, labelB, resolutionUrl, category, summary] = text;
  const positions = [];
  for (const u of users) {
    const [onA, onB] = await client.readContract({ address, abi: POOL_ABI, functionName: "stakeOf", args: [id, u as `0x${string}`] });
    for (const [side, raw] of [[1, onA], [2, onB]] as const) {
      const amount = idx(cfg, raw);
      if (amount > 0n) positions.push({ chain: cfg.id, kind: "pool" as const, marketId: Number(id), user: lower(u), side, amount: amount.toString(), amountUsd: indexToUsd(amount) });
    }
  }
  return {
    market: {
      chain: cfg.id,
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
      lockAt: Number(lock),
      vetoed: vetoed(POOL_STATUS[state] ?? "open", proposal[3]),
      summary,
      stakeA: totalA.toString(),
      stakeB: totalB.toString(),
      volumeUsd: indexToUsd(totalA + totalB),
      // ponytail: participants is filled from the positions table in arc.apply (no on-chain count for pools).
      participants: 0,
      isPrivate: false,
      ...timing(deadline, proposal[1], proposal[2], window),
      updatedBlock: block,
    },
    positions,
  };
}

type Change = { type: "new" | "proposed" | "resolved" | "cancelled"; chain: MarketChainId; kind: Kind; marketId: number };

/** Jev's triage of each new market (lib/jev-triage.ts). Off without TYPESAFE_API_KEY: no call, no row. */
async function triageNew(ctx: ActionCtx, changes: Change[]): Promise<void> {
  if (!jevEnabled()) return;
  for (const c of changes) {
    if (c.type !== "new") continue;
    const m = await ctx.runQuery(internal.arc.marketWithPositions, { chain: c.chain, kind: c.kind, marketId: c.marketId });
    if (!m) continue;
    const t = await triageMarket(m);
    if (t) await ctx.runMutation(internal.arcTriage.save, { chain: c.chain, kind: c.kind, marketId: c.marketId, ...t });
  }
}

/**
 * Post what changed to the site's Telegram route (app/api/telegram/arc-events), which messages the chats. Off unless
 * TELEGRAM_EVENTS_URL and the events secret (MIMIR_EVENTS_SECRET) are set; a failed post is logged, never retried (alerts are best effort).
 * "New" only for markets opened in the last hour, so a re-index does not announce old markets again.
 * No message on a proposal: people hear once, when the result is final (resolved), not while it can still change.
 */
async function notifyTelegram(ctx: ActionCtx, allChanges: Change[]): Promise<void> {
  const url = process.env.TELEGRAM_EVENTS_URL?.trim();
  const secret = internalSecret("events");
  const changes = allChanges.filter((c) => c.type !== "proposed");
  if (!url || !secret || !changes.length) return;
  const recent = Math.floor(Date.now() / 1000) - 3600;
  const events = [];
  for (const c of changes) {
    const m = await ctx.runQuery(internal.arc.marketWithPositions, { chain: c.chain, kind: c.kind, marketId: c.marketId });
    if (!m || m.isPrivate || (c.type === "new" && m.createdAt < recent)) continue;
    const holders = c.type === "cancelled" ? [{ user: m.creator, side: 1 }] : m.positions.map((p) => ({ user: p.user, side: p.side }));
    events.push({
      type: c.type,
      chain: c.chain,
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
