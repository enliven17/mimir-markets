/**
 * Mimir Launch: an agent's creator fees (ported from snipad worker/fees.ts). The flywheel. Per agent, every fee round: claim pump.fun creator fees into the agent wallet and
 * split the claim:
 *   platform 10% + llm 10% (AI costs)  one transfer to the treasury (fixed, PLATFORM_FEES)
 *   the other 80% belongs to the creator, who allocates it across four public buckets (integer
 *   percents summing to 100, Allocation):
 *     bankroll       stays in the wallet (the agent trades with it); rounding dust lands here
 *     buyback        buys the agent's own token and burns it
 *     creatorPayout  accrues; paid to the creator's wallet once >= creatorPayoutMinLamports
 *     holders        accrues into the holders pool; airdropped by ./airdrop.ts
 * A change to the allocation is public and takes effect ALLOCATION_DELAY_MS later; every claim
 * uses the allocation effective at claim time (effectiveAllocation).
 * Every money step is recorded (feeClaims, burns, creatorPayouts, events) through a FeeStore
 * (Convex in prod, convex/launchFeeDb.ts); a failure stops that agent's round without touching
 * the others. Runtime-agnostic on purpose: pages import the constants, Convex V8 code the math.
 * The pump.fun vault PDA (needs web3.js) lives in ./fee-vault.ts. `creator` here is the agent's owner.
 */
import type { Fill, TradeArgs } from "./ports";
import type { Log } from "./worker/log";

// ---------------- the rules ----------------

/** Fixed cut of every claim, percent of the claim. Both go to the treasury. */
export const PLATFORM_FEES = { platformPct: 10, llmPct: 10 } as const;
/** What the creator allocates: 100 - platform - llm percent of every claim. */
export const CREATOR_SHARE_PCT = 100 - PLATFORM_FEES.platformPct - PLATFORM_FEES.llmPct;

export const BUCKETS = ["bankroll", "buyback", "creatorPayout", "holders"] as const;
export type Bucket = (typeof BUCKETS)[number];
/** Whole percents of the creator's 80%, summing to 100. */
export type Allocation = Record<Bucket, number>;
/** Gas and bankroll first: a traded agent pays its own way. */
export const DEFAULT_ALLOCATION: Allocation = { bankroll: 60, buyback: 20, creatorPayout: 20, holders: 0 };

/** A change is public and only applies this long after it was made. */
export const ALLOCATION_DELAY_MS = 24 * 3600_000;

/** null when `a` is a valid allocation; otherwise what is wrong, in words. */
export function allocationProblem(a: unknown): string | null {
  if (!a || typeof a !== "object") return "allocation is missing";
  const rec = a as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (!(BUCKETS as readonly string[]).includes(k)) return `unknown bucket "${k}"`;
  let sum = 0;
  for (const b of BUCKETS) {
    const v = rec[b];
    if (typeof v !== "number" || !Number.isFinite(v)) return `${b} is missing`;
    if (!Number.isInteger(v)) return `${b} must be a whole percent`;
    if (v < 0 || v > 100) return `${b} must be 0 to 100`;
    sum += v;
  }
  return sum === 100 ? null : `buckets must sum to 100, got ${sum}`;
}

export type PendingAllocation = { allocation: Allocation; effectiveAt: number };
export type AllocationState = { allocation: Allocation | null; pendingAllocation: PendingAllocation | null };

/** The allocation that applies at `now`: the pending one once due, else the current one, else the default. */
export function effectiveAllocation(s: AllocationState, now: number): Allocation {
  if (s.pendingAllocation && now >= s.pendingAllocation.effectiveAt) return s.pendingAllocation.allocation;
  return s.allocation ?? DEFAULT_ALLOCATION;
}

export type ClaimSplit = { platform: bigint; llm: bigint; bankroll: bigint; buyback: bigint; creatorPayout: bigint; holders: bigint };

/** Integer split of a claim. Every part floors; the rounding dust stays with the bankroll. */
export function splitClaim(total: bigint, a: Allocation): ClaimSplit {
  const problem = allocationProblem(a);
  if (problem) throw new Error(`bad allocation: ${problem}`);
  const platform = (total * BigInt(PLATFORM_FEES.platformPct)) / 100n;
  const llm = (total * BigInt(PLATFORM_FEES.llmPct)) / 100n;
  const creator = total - platform - llm;
  const part = (pct: number) => (creator * BigInt(pct)) / 100n;
  const buyback = part(a.buyback);
  const creatorPayout = part(a.creatorPayout);
  const holders = part(a.holders);
  return { platform, llm, bankroll: creator - buyback - creatorPayout - holders, buyback, creatorPayout, holders };
}

// ---------------- ports ----------------

type OnSigned = (sig: string, lastValidBlockHeight: number) => Promise<void>;

export type FeeExecutor = {
  claimCreatorFees(a: { walletId: string; wallet: string }): Promise<{ sig: string; lamports: bigint }>;
  /** `onSigned` gets the signature before the first broadcast (record it to reconcile by sig). */
  transferSol(a: { walletId: string; wallet: string; to: string; lamports: bigint; onSigned?: OnSigned }): Promise<string>;
  buy(a: TradeArgs & { lamports: bigint }): Promise<Fill>;
  burn(a: { walletId: string; wallet: string; mint: string; tokens: bigint }): Promise<string>;
  spendable(wallet: string): Promise<bigint>;
};

export type Pools = { creatorPool: bigint; holdersPool: bigint };
export type PayoutStatus = "sent" | "failed" | "unknown";

/** Persistence for the fee flow. Writes keyed by a signature are idempotent. */
export type FeeStore = {
  markClaimed(agentId: string): Promise<void>;
  /**
   * Records the claim once per sig, and in the same write: the treasury share (platform + llm) as an
   * owed transfer (L1) and, with `accrue`, creatorPayout/holders added to the pools. Returns the pools after.
   */
  recordClaim(agentId: string, c: { lamports: bigint; split: ClaimSplit; allocation: Allocation; accrue: boolean; sig: string }): Promise<Pools>;
  recordBurn(agentId: string, b: { mint: string; lamports: bigint; tokens: bigint; buySig: string; burnSig: string }): Promise<void>;
  event(agentId: string, kind: "fee" | "burn" | "error", text: string): Promise<void>;
  /** Reserves `lamports` of the creator pool for one payout; null if the pool is short or a payout is still in flight/unknown. */
  beginCreatorPayout(agentId: string, lamports: bigint): Promise<string | null>;
  /** M7: the payout's signature, stored BEFORE broadcast so a crash is reconciled by sig. */
  payoutSigned(payoutId: string, sig: string, lastValidBlockHeight: number): Promise<void>;
  /** sent: done (with sig). failed: provably not landed, back into the pool. unknown: may have landed, the reconciler settles it. */
  finishCreatorPayout(payoutId: string, r: { status: PayoutStatus; sig?: string }): Promise<void>;
  /** L1: treasury transfers owed and not yet attempted (or provably not landed). */
  owedTreasury(agentId: string): Promise<{ id: string; lamports: bigint }[]>;
  treasurySigned(id: string, sig: string, lastValidBlockHeight: number): Promise<void>;
  /** sent: done. pending: provably not landed, owed again (retried next round). unknown: the reconciler settles it. */
  finishTreasury(id: string, r: { status: "sent" | "pending" | "unknown"; sig?: string }): Promise<void>;
};

export type FeeDeps = {
  store: FeeStore;
  executor: FeeExecutor;
  /** Lamports waiting in the agent's pump.fun creator vault (null = unknown: claim on the 24h schedule). */
  accrued(creatorWallet: string): Promise<bigint | null>;
  treasury: string;
  minClaimLamports: bigint;
  creatorPayoutMinLamports: bigint;
  log: Log;
};

/** What the fee flow needs to know about one launched agent. */
export type FeeAgent = AllocationState & {
  id: string;
  ticker: string;
  mint: string;
  creator: string;
  walletId: string;
  wallet: string;
  status: "live" | "paused" | "killed";
  feesClaimedAt: number | null;
  slippageBps: number;
  creatorPool: bigint;
};

const sol = (l: bigint) => (Number(l) / 1e9).toFixed(3);
const MIN_BUYBACK = 1_000_000n;
/** L2: a buyback never takes more slippage than this, whatever the creator set. */
export const BUYBACK_MAX_SLIPPAGE_BPS = 300;

/** True when the error proves nothing landed (lib/launch/solana notLanded, or a landed tx that failed and moved nothing). */
const provablyNotPaid = (err: unknown) => (err as { notLanded?: boolean })?.notLanded === true || (err as { name?: string })?.name === "TxFailedError";
const sigOf = (err: unknown) => (err as { sig?: string })?.sig;

/**
 * M6: the split a claim is booked with. A killed agent keeps the allocation in force (buyback and
 * holders keep running, the 24h delay still binds); only the bankroll share, which can no longer be
 * traded, is redirected to the creator payout.
 */
export function bookedSplit(parts: ClaimSplit, killed: boolean): ClaimSplit {
  return killed ? { ...parts, creatorPayout: parts.creatorPayout + parts.bankroll, bankroll: 0n } : parts;
}

/** One agent's claim + split. Returns lamports claimed (0 when skipped). */
export async function claimAndSplit(a: FeeAgent, d: FeeDeps, now = Date.now()): Promise<bigint> {
  const accrued = await d.accrued(a.wallet).catch(() => null);
  const stale = a.feesClaimedAt === null || now - a.feesClaimedAt > 24 * 3600_000;
  if (accrued !== null ? accrued < d.minClaimLamports : !stale) return 0n;

  // Marked before the claim: a failing claim must not be retried every round.
  await d.store.markClaimed(a.id);
  const claim = await d.executor.claimCreatorFees({ walletId: a.walletId, wallet: a.wallet });
  if (claim.lamports <= 0n) return 0n; // nothing (net of the tx fee) came in
  const allocation = effectiveAllocation(a, now);
  const parts = bookedSplit(splitClaim(claim.lamports, allocation), a.status === "killed");
  const pools = await d.store.recordClaim(a.id, { lamports: claim.lamports, split: parts, allocation, accrue: true, sig: claim.sig });
  await d.store.event(a.id, "fee", `claimed ${sol(claim.lamports)} SOL in creator fees: ${sol(parts.bankroll)} to the bankroll`);

  await payTreasury(a, d);
  // Buy back and burn the agent's own token (also after a kill: the allocation stays in force).
  if (parts.buyback >= MIN_BUYBACK) {
    const fill = await d.executor.buy({
      walletId: a.walletId, wallet: a.wallet, mint: a.mint, lamports: parts.buyback, ownMint: a.mint,
      slippageBps: Math.min(a.slippageBps, BUYBACK_MAX_SLIPPAGE_BPS),
    });
    const burnSig = await d.executor.burn({ walletId: a.walletId, wallet: a.wallet, mint: a.mint, tokens: fill.tokens });
    await d.store.recordBurn(a.id, { mint: a.mint, lamports: fill.lamports, tokens: fill.tokens, buySig: fill.sig, burnSig });
    await d.store.event(a.id, "burn", `bought back and burned $${a.ticker} for ${sol(fill.lamports)} SOL`);
  }
  await payCreator({ ...a, creatorPool: pools.creatorPool }, d);
  return claim.lamports;
}

/**
 * L1: pays every owed treasury transfer. Each one is its own record with its signature stored before
 * broadcast; a provably failed one stays owed (retried next round, never folded into the bankroll),
 * an ambiguous one waits for the reconciler. Throws on the first failure.
 */
export async function payTreasury(a: Pick<FeeAgent, "id" | "walletId" | "wallet">, d: Pick<FeeDeps, "store" | "executor" | "treasury" | "log">): Promise<bigint> {
  let paid = 0n;
  for (const t of await d.store.owedTreasury(a.id)) {
    let sig: string;
    try {
      sig = await d.executor.transferSol({ walletId: a.walletId, wallet: a.wallet, to: d.treasury, lamports: t.lamports, onSigned: (s, lvbh) => d.store.treasurySigned(t.id, s, lvbh) });
    } catch (err) {
      if (provablyNotPaid(err)) await d.store.finishTreasury(t.id, { status: "pending" });
      else {
        await d.store.finishTreasury(t.id, { status: "unknown", ...(sigOf(err) ? { sig: sigOf(err) } : {}) });
        await d.store.event(a.id, "error", `RECONCILE: treasury transfer of ${sol(t.lamports)} SOL may have landed; it is checked by signature before anything is sent again`);
      }
      throw err;
    }
    await d.store.finishTreasury(t.id, { status: "sent", sig });
    d.log.info("fee to treasury", { agentId: a.id, lamports: t.lamports.toString(), sig });
    paid += t.lamports;
  }
  return paid;
}

/**
 * Pays the creator pool to the creator's wallet once it reaches the minimum. The amount is
 * reserved in the store before the transfer and the signature recorded before broadcast (M7), so a
 * crash or a retry can never pay it twice.
 */
export async function payCreator(a: Pick<FeeAgent, "id" | "walletId" | "wallet" | "creator" | "creatorPool">, d: Pick<FeeDeps, "store" | "executor" | "creatorPayoutMinLamports" | "log">): Promise<bigint> {
  if (a.creatorPool < d.creatorPayoutMinLamports) return 0n;
  const id = await d.store.beginCreatorPayout(a.id, a.creatorPool);
  if (!id) return 0n;
  let sig: string;
  try {
    sig = await d.executor.transferSol({ walletId: a.walletId, wallet: a.wallet, to: a.creator, lamports: a.creatorPool, onSigned: (s, lvbh) => d.store.payoutSigned(id, s, lvbh) });
  } catch (err) {
    if (provablyNotPaid(err)) {
      await d.store.finishCreatorPayout(id, { status: "failed" });
    } else {
      const maybe = sigOf(err);
      await d.store.finishCreatorPayout(id, { status: "unknown", ...(maybe ? { sig: maybe } : {}) });
      await d.store.event(a.id, "error", `RECONCILE: creator payout of ${sol(a.creatorPool)} SOL may have landed${maybe ? ` (sig ${maybe})` : ""}; payouts wait until it is checked`);
    }
    throw err;
  }
  await d.store.finishCreatorPayout(id, { status: "sent", sig });
  await d.store.event(a.id, "fee", `paid ${sol(a.creatorPool)} SOL to the creator`);
  return a.creatorPool;
}

/** Everything owed that does not need a new claim: treasury transfers, then a creator pool at the minimum. */
export async function payOwed(a: Pick<FeeAgent, "id" | "walletId" | "wallet" | "creator" | "creatorPool">, d: Pick<FeeDeps, "store" | "executor" | "treasury" | "creatorPayoutMinLamports" | "log">): Promise<void> {
  await payTreasury(a, d);
  await payCreator(a, d);
}

/** claimAndSplit that never throws: a failure is logged and shown on the live view. */
export async function feeForAgent(a: FeeAgent, d: FeeDeps): Promise<bigint> {
  try {
    return await claimAndSplit(a, d);
  } catch (err) {
    d.log.error("fee round failed for agent", { agentId: a.id, err });
    await d.store.event(a.id, "error", "fee claim failed, will retry next round").catch((e) => d.log.warn("fee error event failed", { agentId: a.id, err: e }));
    return 0n;
  }
}
