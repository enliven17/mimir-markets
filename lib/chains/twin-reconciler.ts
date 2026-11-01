/**
 * The twin reconciler's pass (convex/arcTwins.ts wires it to Convex, Circle and the chains; lib/chains/twins.ts plans
 * each twin). Everything it touches comes in through `deps`, so the flow is tested with fakes
 * (tests/node/chain-twins.test.ts):
 *
 *   1. twins already sent: read the market id they opened and link both legs; a send that never recorded a tx is
 *      marked failed (step 2 then adopts its market if it did open, or retries)
 *   2. pools missing a leg: adopt an identical pool already on that chain (link, open nothing); else plan it; a skip is
 *      final, a wait is looked at again later; an open moderates a user's pool (Jev), checks the house wallet's funds,
 *      reserves the seed in the shared house budget, opens the pool and links it. A failed open releases the budget
 *      and is retried with backoff, then skipped after `maxAttempts` (a twin the contract rejects).
 */
import type { MarketChainId } from "./registry";
import { planTwin, twinPairKey, isHouseSource, type TwinContext, type TwinSource } from "./twins";

export type TwinStatus = "waiting" | "sending" | "sent" | "linked" | "skipped" | "failed";

export interface TwinRowKey {
  srcChain: MarketChainId;
  srcMarketId: number;
  chain: MarketChainId;
  pairKey: string;
  creator: string;
  house: boolean;
}

export interface TwinRowPut extends TwinRowKey {
  status: TwinStatus;
  reason?: string;
  tx?: string;
  marketId?: number;
  seed?: string;
  day?: string;
  bumpAttempts?: boolean;
  notBefore?: number;
}

export interface PendingTwin extends TwinRowKey {
  status: TwinStatus;
  tx?: string;
  /** ms, when the row was last written. */
  at: number;
}

export interface TwinCandidate extends TwinSource {
  missing: MarketChainId[];
  triage: { spam: number; resolvable: number } | null;
  twins: Array<{ chain: MarketChainId; status: string; notBefore: number; attempts: number }>;
}

type Ref = { chain: MarketChainId; marketId: number };

export interface TwinDeps {
  pending(): Promise<PendingTwin[]>;
  /** The market a sent twin's tx opened (index first, then the receipt), or null. */
  resolveTx(chain: MarketChainId, tx: string): Promise<number | null>;
  candidates(): Promise<TwinCandidate[]>;
  findSame(target: MarketChainId, pairKey: string, s: TwinSource): Promise<number | null>;
  /** The planner's context for one (source, target): wallet, budget, triage, caps. */
  planContext(s: TwinCandidate, target: MarketChainId, house: boolean): Promise<TwinContext>;
  /** Claim moderation of a user's pool before the house's money goes in: "block" is final. */
  moderate(s: TwinSource): Promise<"block" | null>;
  /** The house wallet on `target` holds the seed (and gas). */
  funded(target: MarketChainId, seedWei: bigint): Promise<boolean>;
  reserve(target: MarketChainId, seedWei: bigint, ref: string): Promise<string | null>;
  release(hold: string): Promise<void>;
  create(target: MarketChainId, s: TwinSource, side: 1 | 2, seedWei: bigint): Promise<string>;
  createdId(target: MarketChainId, tx: string): Promise<number | null>;
  link(pairKey: string, a: Ref, b: Ref): Promise<void>;
  put(row: TwinRowPut): Promise<void>;
  log?(line: string): void;
}

export interface TwinOptions {
  /** ms */
  now: number;
  day: string;
  houseAddresses: ReadonlySet<string>;
  perTick?: number;
  maxAttempts?: number;
  dryRun?: boolean;
  waitMs?: number;
  lostSendMs?: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);

export async function reconcileTwins(deps: TwinDeps, o: TwinOptions): Promise<{ opened: number; touched: Set<MarketChainId> }> {
  const log = deps.log ?? (() => {});
  const waitMs = o.waitMs ?? 15 * 60_000;
  const lostSendMs = o.lostSendMs ?? 15 * 60_000;
  const perTick = o.perTick ?? 4;
  const maxAttempts = o.maxAttempts ?? 3;
  const touched = new Set<MarketChainId>();

  // 1. Sent twins.
  for (const row of await deps.pending()) {
    const key: TwinRowKey = { srcChain: row.srcChain, srcMarketId: row.srcMarketId, chain: row.chain, pairKey: row.pairKey, creator: row.creator, house: row.house };
    const id = row.tx ? await deps.resolveTx(row.chain, row.tx) : null;
    if (id !== null) {
      await deps.link(row.pairKey, { chain: row.srcChain, marketId: row.srcMarketId }, { chain: row.chain, marketId: id });
      await deps.put({ ...key, status: "linked", marketId: id, reason: "opened" });
      touched.add(row.chain);
    } else if (row.status === "sending" && o.now - row.at > lostSendMs) {
      await deps.put({ ...key, status: "failed", reason: "send lost before a tx was recorded", notBefore: o.now });
    }
  }

  // 2. Pools missing a leg.
  let opened = 0;
  for (const s of await deps.candidates()) {
    for (const target of s.missing) {
      if (opened >= perTick) break;
      const row = s.twins.find((t) => t.chain === target);
      if (row && (row.status === "skipped" || row.status === "linked" || row.status === "sending" || row.status === "sent")) continue;
      if (row && row.notBefore > o.now) continue;
      const pairKey = twinPairKey(s);
      const house = isHouseSource(s, o.houseAddresses);
      const key: TwinRowKey = { srcChain: s.chain, srcMarketId: s.marketId, chain: target, pairKey, creator: s.creator.toLowerCase(), house };
      const tag = `[twins] ${s.chain} pool #${s.marketId} → ${target}`;

      const same = await deps.findSame(target, pairKey, s);
      if (same !== null) {
        await deps.link(pairKey, { chain: s.chain, marketId: s.marketId }, { chain: target, marketId: same });
        await deps.put({ ...key, status: "linked", marketId: same, reason: "adopted an identical pool" });
        log(`${tag}: linked existing #${same}`);
        continue;
      }

      const plan = planTwin(s, await deps.planContext(s, target, house));
      if (plan.action === "skip") {
        await deps.put({ ...key, status: "skipped", reason: plan.reason });
        log(`${tag}: skipped (${plan.reason})`);
        continue;
      }
      if (plan.action === "wait") {
        await deps.put({ ...key, status: "waiting", reason: plan.reason, notBefore: o.now + waitMs });
        continue;
      }
      if (!plan.house && (await deps.moderate(s)) === "block") {
        await deps.put({ ...key, status: "skipped", reason: "blocked by claim moderation" });
        continue;
      }
      if (!(await deps.funded(target, plan.seedWei))) {
        await deps.put({ ...key, status: "waiting", reason: "house wallet unfunded", notBefore: o.now + waitMs });
        log(`${tag}: the house creator wallet on ${target} needs USDC (and gas)`);
        continue;
      }
      if (o.dryRun) {
        log(`${tag}: (dry run) would open with ${plan.seedWei} on side ${plan.side}`);
        continue;
      }
      const hold = await deps.reserve(target, plan.seedWei, `twin:${s.chain}:${s.marketId}`);
      if (hold === null) {
        await deps.put({ ...key, status: "waiting", reason: "house budget for today used", notBefore: o.now + waitMs });
        continue;
      }
      await deps.put({ ...key, status: "sending", seed: plan.seedWei.toString(), day: o.day, bumpAttempts: true });
      opened++;
      let tx: string;
      try {
        tx = await deps.create(target, s, plan.side, plan.seedWei);
      } catch (err) {
        await deps.release(hold);
        const attempts = (row?.attempts ?? 0) + 1;
        const final = attempts >= maxAttempts;
        await deps.put({ ...key, status: final ? "skipped" : "failed", reason: `${final ? "rejected: " : ""}${errText(err)}`, notBefore: o.now + waitMs * 2 ** attempts });
        log(`${tag}: open failed (${attempts}/${maxAttempts}): ${errText(err)}`);
        continue;
      }
      await deps.put({ ...key, status: "sent", tx });
      log(`${tag}: opened ${tx}`);
      touched.add(target);
      const id = await deps.createdId(target, tx).catch(() => null);
      if (id !== null) {
        await deps.link(pairKey, { chain: s.chain, marketId: s.marketId }, { chain: target, marketId: id });
        await deps.put({ ...key, status: "linked", marketId: id, reason: "opened" });
      }
    }
    if (opened >= perTick) break;
  }
  return { opened, touched };
}
