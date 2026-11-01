/**
 * Mimir Launch copy staking on Arc, the pure part. A follower copies an agent's (or a council persona's) market stakes
 * from a Circle copy wallet of their own: when the agent stakes on a pool, each active follower stakes the same side,
 * capped by their max per stake and keeping a gas reserve. Mimir's fee is the contracts' own (the copy/referrer fee),
 * nothing more. The fan-out is lib/launch/arc-copy.ts; one follower's job is runArcCopy (convex/launchCopyJobs.ts).
 */
import type { Log } from "./log";

/** Left in an Arc copy wallet for its own gas. */
export const COPY_GAS_RESERVE_USDC = 0.05;

export type JobStatus = "done" | "failed" | "unknown" | "skipped";

const short = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** A racing request's fresh wallet never replaces the stored one (its id and address win). */
export function keepStoredWallet<T extends { walletId: string; address: string }>(stored: T | undefined, next: T | undefined): T | undefined {
  return stored && next ? { ...next, walletId: stored.walletId, address: stored.address } : (stored ?? next);
}

export type ArcSubRow = { id: string; follower: string; walletId: string; wallet: string; maxPerStakeUsdc: number; active: boolean; on: boolean };

/** The stake each Arc follower places: its cap, within its balance minus the gas reserve, in cents; 0 = skip. */
export function arcCopyAmount(capUsdc: number, balanceUsdc: number, minStakeUsdc: number): number {
  const amount = Math.floor(Math.min(capUsdc, balanceUsdc - COPY_GAS_RESERVE_USDC) * 100) / 100;
  return amount >= minStakeUsdc ? amount : 0;
}

export type ArcCopyDeps = {
  store: {
    /** Takes the job's key once; false = it already ran (or is running): do nothing. */
    claim(key: string, sub: string): Promise<boolean>;
    finish(key: string, status: JobStatus, note?: string): Promise<void>;
    arcSub(subId: string): Promise<ArcSubRow | null>;
  };
  balanceUsdc(wallet: string): Promise<number>;
  /** Stakes `amountUsdc` on pool `marketId`, side `side`, from the copy wallet; returns the tx hash. */
  stake(a: { walletId: string; marketId: number; side: number; amountUsdc: number }): Promise<string>;
  log: Log;
  minStakeUsdc: number;
};

/**
 * One follower's copy of an agent's pool stake. Never retried: a Circle call that timed out may still land, so an
 * error is "unknown" (the stake shows up in the Arc index under the copy wallet if it did).
 */
export async function runArcCopy(d: ArcCopyDeps, job: { key: string; sub: string; marketId: number; side: number }): Promise<JobStatus> {
  if (!(await d.store.claim(job.key, job.sub))) return "skipped";
  const done = async (status: JobStatus, note?: string) => (await d.store.finish(job.key, status, note), status);
  const s = await d.store.arcSub(job.sub);
  if (!s || !s.active || !s.on) return done("skipped", "not copying");
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
