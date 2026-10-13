/**
 * Mimir Launch copy trading (ported from snipad worker/copy.ts). A follower picks what to copy: the agent's Solana
 * trades, its Arc market stakes, or both. Each side runs from a wallet of the follower's own subscription:
 *   Solana  a Privy copy wallet locked to trading + SOL back to the follower. When the agent buys, it buys the same
 *           token (capped by the follower's max per trade and what the wallet holds); when the agent sells a fraction
 *           of a position, it sells the same fraction of its own.
 *   Arc     a Circle copy wallet. When the agent stakes on a pool, it stakes the same side (capped by the follower's
 *           max per stake, keeping a gas reserve).
 * The agent's tick only fans out (createMirror): one job per follower, keyed on (subscription, agent signature), so a
 * slow follower never holds up the agent, and a retried tick never copies twice. Each job (runSolBuy, runSolSell,
 * runArcCopy) runs on its own; a copy buy stores its signature before broadcast, so one that lands after a timeout is
 * settled by signature (reconcileCopyBuy) instead of being lost or bought again.
 * Holding $MIMIR is a condition of USING copy trading (lib/launch/copy-gate.ts): "no" pauses the subscription (no new
 * entries; what it holds still exits with the agent), "unknown" (an RPC hiccup) just skips this entry.
 * Runtime-agnostic: persistence goes through the stores below.
 */
import type { Fill, TradeArgs } from "../ports";
import type { Holding } from "../copy-gate";
import type { Log } from "./log";

/** A follower's copy buy never takes more slippage than this, whatever the agent uses. */
export const COPY_MAX_SLIPPAGE_BPS = 300;
export const MIN_COPY_LAMPORTS = 10_000_000n; // 0.01 SOL
/** Left in an Arc copy wallet for its own gas. */
export const COPY_GAS_RESERVE_USDC = 0.05;

export type HoldsCheck = (follower: string) => Promise<Holding>;

// ---------------- fan-out: the agent's tick hands its fill to the followers ----------------

export type SolJob =
  | { kind: "buy"; key: string; sub: string; mint: string; slippageBps: number }
  | { kind: "sell"; key: string; sub: string; mint: string; fraction: number; slippageBps: number };

export type CopyFanout = {
  /** Active subscriptions with the Solana side on. */
  solSubs(agentId: string): Promise<{ id: string }[]>;
  /** Every subscription (active or not) holding `mint`: paused followers still exit. */
  holders(agentId: string, mint: string): Promise<{ id: string }[]>;
  schedule(job: SolJob): Promise<void>;
};

export function createMirror(f: CopyFanout, log: Log) {
  const fan = async (agentId: string, list: () => Promise<{ id: string }[]>, job: (subId: string) => SolJob) => {
    let subs: { id: string }[] = [];
    try {
      subs = await list();
    } catch (err) {
      log.warn("copy subs read failed", { agentId, err });
    }
    for (const s of subs) await f.schedule(job(s.id)).catch((err) => log.warn("copy job not scheduled", { agentId, subId: s.id, err }));
  };
  return {
    async buy(agentId: string, mint: string, slippageBps: number, sig: string) {
      const slip = Math.min(slippageBps, COPY_MAX_SLIPPAGE_BPS);
      await fan(agentId, () => f.solSubs(agentId), (sub) => ({ kind: "buy", key: `${sub}:buy:${sig}`, sub, mint, slippageBps: slip }));
    },
    /** `fraction` of each follower's holding in `mint` (>= 1 sells it all). */
    async sell(agentId: string, mint: string, fraction: number, slippageBps: number, sig: string) {
      await fan(agentId, () => f.holders(agentId, mint), (sub) => ({ kind: "sell", key: `${sub}:sell:${sig}`, sub, mint, fraction, slippageBps }));
    },
  };
}
export type Mirror = ReturnType<typeof createMirror>;

/**
 * M1: a subscription side's wallet, once stored, is never replaced: a later (or racing) request only changes the
 * settings. `next`'s fresh wallet is dropped when one is already stored.
 */
export function keepStoredWallet<T extends { walletId: string; address: string }>(stored: T | undefined, next: T | undefined): T | undefined {
  return stored && next ? { ...next, walletId: stored.walletId, address: stored.address } : (stored ?? next);
}

// ---------------- one follower's Solana job ----------------

type OnSigned = (sig: string, lastValidBlockHeight: number) => Promise<void>;
export type SolExec = {
  buy(a: TradeArgs & { lamports: bigint; onSigned?: OnSigned }): Promise<Fill>;
  sell(a: TradeArgs & { tokens: bigint }): Promise<Fill>;
  spendable(wallet: string): Promise<bigint>;
  tokenBalance?(wallet: string, mint: string): Promise<bigint>;
};

export type SolSubRow = { id: string; follower: string; walletId: string; wallet: string; maxPerTradeLamports: bigint; active: boolean; on: boolean };
export type JobStatus = "done" | "failed" | "unknown" | "skipped";

export type CopyJobStore = {
  /** Takes the job's key once; false = it already ran (or is running): do nothing. */
  claim(key: string, sub: string, kind: "buy" | "sell" | "arc"): Promise<boolean>;
  solSub(subId: string): Promise<SolSubRow | null>;
  held(subId: string, mint: string): Promise<bigint>;
  /** The copy buy's signature, stored before broadcast. */
  buySigned(key: string, mint: string, sig: string, lastValidBlockHeight: number): Promise<void>;
  /** Adds the bought tokens to the subscription's position once per key, and closes the job as done. */
  addFill(key: string, subId: string, mint: string, tokens: bigint, costLamports: bigint): Promise<void>;
  /** After selling: `left` of `held` remains; the row goes at 0. */
  settleSell(subId: string, mint: string, held: bigint, left: bigint): Promise<void>;
  finish(key: string, status: JobStatus, note?: string): Promise<void>;
  pauseForGate(subId: string): Promise<void>;
};

/** True when the error proves nothing landed (a rejected preflight, or a landed tx that failed). */
const provablyNotLanded = (err: unknown) => (err as { notLanded?: boolean })?.notLanded === true || (err as { name?: string })?.name === "TxFailedError";
const short = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

export async function runSolBuy(store: CopyJobStore, executor: SolExec, holds: HoldsCheck, log: Log, job: Extract<SolJob, { kind: "buy" }>): Promise<JobStatus> {
  if (!(await store.claim(job.key, job.sub, "buy"))) return "skipped";
  const s = await store.solSub(job.sub);
  if (!s || !s.active || !s.on) return finish(store, job.key, "skipped", "not copying");
  const h = await holds(s.follower);
  if (h === "no") {
    await store.pauseForGate(s.id);
    return finish(store, job.key, "skipped", "no $MIMIR: paused");
  }
  if (h === "unknown") return finish(store, job.key, "skipped", "could not read $MIMIR");
  const have = await executor.spendable(s.wallet);
  const lamports = have < s.maxPerTradeLamports ? have : s.maxPerTradeLamports;
  if (lamports < MIN_COPY_LAMPORTS) return finish(store, job.key, "skipped", "copy wallet short");
  try {
    const fill = await executor.buy({
      walletId: s.walletId, wallet: s.wallet, mint: job.mint, lamports, slippageBps: Math.min(job.slippageBps, COPY_MAX_SLIPPAGE_BPS),
      onSigned: (sig, lvbh) => store.buySigned(job.key, job.mint, sig, lvbh),
    });
    await store.addFill(job.key, s.id, job.mint, fill.tokens, fill.lamports);
    return "done";
  } catch (err) {
    log.warn("copy buy failed", { subId: s.id, mint: job.mint, err });
    // Ambiguous: it may have landed; the reconciler settles it by its stored signature.
    return finish(store, job.key, provablyNotLanded(err) ? "failed" : "unknown", short(err));
  }
}

export async function runSolSell(store: CopyJobStore, executor: SolExec, log: Log, job: Extract<SolJob, { kind: "sell" }>): Promise<JobStatus> {
  if (!(await store.claim(job.key, job.sub, "sell"))) return "skipped";
  const s = await store.solSub(job.sub);
  if (!s) return finish(store, job.key, "skipped", "no subscription");
  const held = await store.held(s.id, job.mint);
  const bps = BigInt(Math.min(10_000, Math.max(0, Math.floor(job.fraction * 10_000))));
  const tokens = job.fraction >= 1 ? held : (held * bps) / 10_000n;
  if (tokens <= 0n) return finish(store, job.key, "skipped", "nothing held");
  try {
    const fill = await executor.sell({ walletId: s.walletId, wallet: s.wallet, mint: job.mint, tokens, slippageBps: job.slippageBps });
    const sold = fill.tokens > 0n ? fill.tokens : tokens;
    await store.settleSell(s.id, job.mint, held, held > sold ? held - sold : 0n);
    return finish(store, job.key, "done");
  } catch (err) {
    log.warn("copy sell failed", { subId: s.id, mint: job.mint, err });
    return finish(store, job.key, provablyNotLanded(err) ? "failed" : "unknown", short(err));
  }
}

async function finish(store: CopyJobStore, key: string, status: JobStatus, note?: string): Promise<JobStatus> {
  await store.finish(key, status, note);
  return status;
}

/**
 * A copy buy whose outcome was never recorded (an ambiguous send, or the action died): settle its stored signature.
 * Landed: the tokens it really bought (`deltas`) go on the position, once. Provably not landed: failed. Else: open.
 */
export async function reconcileCopyBuy(
  row: { key: string; sub: string; mint: string; sig: string; lastValidBlockHeight: number },
  settle: (sig: string, lastValidBlockHeight: number) => Promise<"landed" | "failed" | "pending" | "notLanded" | "unknown">,
  deltas: (sig: string) => Promise<{ tokens: bigint; lamports: bigint }>,
  store: Pick<CopyJobStore, "addFill" | "finish">,
): Promise<"done" | "failed" | "open"> {
  const s = await settle(row.sig, row.lastValidBlockHeight);
  if (s === "landed") {
    const d = await deltas(row.sig);
    await store.addFill(row.key, row.sub, row.mint, d.tokens, d.lamports);
    return "done";
  }
  if (s === "failed" || s === "notLanded") {
    await store.finish(row.key, "failed", `settled: ${s}`);
    return "failed";
  }
  return "open";
}

/**
 * The follower's "sell my copied tokens": sells the copy wallet's actual on-chain balance of every mint it ever copied
 * (what the records say may be short after an unrecorded fill), then its SOL is free to withdraw. Throws on the first
 * failure (the follower can run it again).
 */
export async function drainCopies(
  store: Pick<CopyJobStore, "settleSell">,
  executor: Required<Pick<SolExec, "sell" | "tokenBalance">>,
  s: { id: string; walletId: string; wallet: string },
  mints: readonly string[],
  slippageBps = COPY_MAX_SLIPPAGE_BPS,
): Promise<number> {
  let sold = 0;
  for (const mint of mints) {
    const held = await executor.tokenBalance(s.wallet, mint);
    if (held > 0n) {
      await executor.sell({ walletId: s.walletId, wallet: s.wallet, mint, tokens: held, slippageBps, protect: mints.filter((m) => m !== mint) });
      sold++;
    }
    await store.settleSell(s.id, mint, held, 0n);
  }
  return sold;
}

// ---------------- one follower's Arc job ----------------

export type ArcSubRow = { id: string; follower: string; walletId: string; wallet: string; maxPerStakeUsdc: number; active: boolean; on: boolean };

/** The stake each Arc follower places: its cap, within its balance minus the gas reserve, in cents; 0 = skip. */
export function arcCopyAmount(capUsdc: number, balanceUsdc: number, minStakeUsdc: number): number {
  const amount = Math.floor(Math.min(capUsdc, balanceUsdc - COPY_GAS_RESERVE_USDC) * 100) / 100;
  return amount >= minStakeUsdc ? amount : 0;
}

export type ArcCopyDeps = {
  store: Pick<CopyJobStore, "claim" | "finish" | "pauseForGate"> & { arcSub(subId: string): Promise<ArcSubRow | null> };
  balanceUsdc(wallet: string): Promise<number>;
  /** Stakes `amountUsdc` on pool `marketId`, side `side`, from the copy wallet; returns the tx hash. */
  stake(a: { walletId: string; marketId: number; side: number; amountUsdc: number }): Promise<string>;
  holds: HoldsCheck;
  log: Log;
  minStakeUsdc: number;
};

/**
 * One follower's copy of an agent's pool stake. Never retried: a Circle call that timed out may still land, so an
 * error is "unknown" (the stake shows up in the Arc index under the copy wallet if it did).
 */
export async function runArcCopy(d: ArcCopyDeps, job: { key: string; sub: string; marketId: number; side: number }): Promise<JobStatus> {
  if (!(await d.store.claim(job.key, job.sub, "arc"))) return "skipped";
  const done = async (status: JobStatus, note?: string) => (await d.store.finish(job.key, status, note), status);
  const s = await d.store.arcSub(job.sub);
  if (!s || !s.active || !s.on) return done("skipped", "not copying");
  const h = await d.holds(s.follower);
  if (h === "no") {
    await d.store.pauseForGate(s.id);
    return done("skipped", "no $MIMIR: paused");
  }
  if (h === "unknown") return done("skipped", "could not read $MIMIR");
  let amount: number;
  try {
    amount = arcCopyAmount(s.maxPerStakeUsdc, await d.balanceUsdc(s.wallet), d.minStakeUsdc);
  } catch (err) {
    return done("failed", short(err));
  }
  if (!amount) return done("skipped", "copy wallet short");
  try {
    const tx = await d.stake({ walletId: s.walletId, marketId: job.marketId, side: job.side, amountUsdc: amount });
    return done("done", tx);
  } catch (err) {
    d.log.warn("arc copy stake failed", { subId: s.id, marketId: job.marketId, err });
    return done("unknown", short(err));
  }
}
