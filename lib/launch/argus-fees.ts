/**
 * Mimir Launch on Argus: one agent's fee round (convex/launchArgus.ts runs it, holding the agent's lease).
 *   1. Settle the Circle tx left in flight by an earlier round (recorded before it was waited on): done = book it,
 *      failed = drop it, still pending = stop here. So a send that timed out is settled, never repeated.
 *   2. At most once per interval: poke the locker and splitter (collect LP fees, distribute: Argus takes its 10%, the
 *      buyback share burns), then claim the agent wallet's share when it is worth the gas, and book it with claimSplit:
 *      Mimir's platform 10% + AI 10% become owed to the treasury; the owner's bankroll and payout stay in the wallet
 *      (the owner withdraws Arc USDC from there).
 *   3. Send what is owed to the treasury once it passes the minimum.
 * Every Circle submit carries an idempotency key derived from the ledger, so a resubmit after a lost response is the
 * same transaction. Pure: chain and storage are injected.
 */
import { createHash } from "node:crypto";

import { claimSplit, type OwnerSplit } from "./argus";

export interface ArgusFeeState {
  claimed6: string;
  owedTreasury6: string;
  paidTreasury6: string;
  lastRoundAt: number;
  pending?: { step: "claim" | "treasury"; circleId: string; amount6: string; at: number };
}

export interface ArgusFeeAgent {
  id: string;
  ticker: string;
  walletId: string;
  wallet: string;
  splitter: string;
  locker: string;
  creatorBps: number;
  split: OwnerSplit;
  fees: ArgusFeeState | null;
}

export interface ArgusFeeDeps {
  claimable6: (a: ArgusFeeAgent) => Promise<bigint>;
  /** locker.collect() then splitter.distribute(); best effort (both permissionless, anyone may have run them). */
  poke: (a: ArgusFeeAgent) => Promise<void>;
  submitClaim: (a: ArgusFeeAgent, key: string) => Promise<string>;
  submitTreasury: (a: ArgusFeeAgent, amount6: bigint, key: string) => Promise<string>;
  state: (circleId: string) => Promise<{ state: "done"; txHash: string } | { state: "failed"; reason: string } | { state: "pending" }>;
  /** Waits for a submitted tx; throws when it fails or does not confirm in time (then it stays pending). */
  wait: (circleId: string) => Promise<string>;
  save: (id: string, fees: ArgusFeeState) => Promise<void>;
  event: (id: string, text: string, tx?: string) => Promise<void>;
  now: number;
  intervalMs: number;
  minClaim6: bigint;
  minTreasury6: bigint;
}

export const ZERO_FEES: ArgusFeeState = { claimed6: "0", owedTreasury6: "0", paidTreasury6: "0", lastRoundAt: 0 };
const STUCK_MS = 24 * 60 * 60_000;
const usdc = (x: bigint) => (Number(x) / 1e6).toFixed(2);

/** A UUID-shaped idempotency key, fixed for one step of one agent's ledger. */
export const feeKey = (...parts: Array<string | number>) => {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function book(a: ArgusFeeAgent, f: ArgusFeeState, step: "claim" | "treasury", amount6: bigint): { fees: ArgusFeeState; text: string } {
  const { pending: _done, ...rest } = f;
  if (step === "treasury") {
    return {
      fees: { ...rest, owedTreasury6: (BigInt(f.owedTreasury6) - amount6).toString(), paidTreasury6: (BigInt(f.paidTreasury6) + amount6).toString() },
      text: `sent ${usdc(amount6)} USDC of $${a.ticker}'s Argus fees to Mimir (platform + AI)`,
    };
  }
  const s = claimSplit(amount6, a.creatorBps, a.split);
  return {
    fees: { ...rest, claimed6: (BigInt(f.claimed6) + amount6).toString(), owedTreasury6: (BigInt(f.owedTreasury6) + s.platform + s.ai).toString() },
    text: `claimed ${usdc(amount6)} USDC of $${a.ticker} fees from Argus: ${usdc(s.bankroll)} bankroll, ${usdc(s.payout)} owner payout (both stay in its Arc wallet), ${usdc(s.platform + s.ai)} to Mimir`,
  };
}

/** One step: submit, record it as pending, wait, book. A wait that throws leaves it pending for the next round. */
async function run(a: ArgusFeeAgent, f: ArgusFeeState, d: ArgusFeeDeps, step: "claim" | "treasury", amount6: bigint, submit: (key: string) => Promise<string>): Promise<ArgusFeeState> {
  const key = step === "claim" ? feeKey(a.id, "claim", f.claimed6, f.lastRoundAt) : feeKey(a.id, "treasury", f.paidTreasury6);
  const circleId = await submit(key);
  let fees: ArgusFeeState = { ...f, pending: { step, circleId, amount6: amount6.toString(), at: d.now } };
  await d.save(a.id, fees);
  let tx: string;
  try {
    tx = await d.wait(circleId);
  } catch {
    return fees; // settled by the next round
  }
  const b = book(a, fees, step, amount6);
  fees = b.fees;
  await d.save(a.id, fees);
  await d.event(a.id, b.text, tx);
  return fees;
}

export async function argusFeeRound(a: ArgusFeeAgent, d: ArgusFeeDeps): Promise<ArgusFeeState> {
  let f = a.fees ?? ZERO_FEES;
  if (f.pending) {
    const p = f.pending;
    const s = await d.state(p.circleId);
    if (s.state === "pending") {
      if (d.now - p.at > STUCK_MS) await d.event(a.id, `Argus fee ${p.step} ${p.circleId} has been pending for a day: check it by hand`);
      return f;
    }
    if (s.state === "done") {
      const b = book(a, f, p.step, BigInt(p.amount6));
      f = b.fees;
      await d.event(a.id, b.text, s.txHash);
    } else {
      const { pending: _failed, ...rest } = f;
      f = rest;
      await d.event(a.id, `Argus fee ${p.step} failed (${s.reason.slice(0, 120)}); nothing moved, it is retried`);
    }
    await d.save(a.id, f);
  }

  if (d.now - f.lastRoundAt >= d.intervalMs) {
    await d.poke(a).catch(() => undefined);
    f = { ...f, lastRoundAt: d.now };
    await d.save(a.id, f);
    const claimable = await d.claimable6(a);
    if (claimable >= d.minClaim6) {
      f = await run(a, f, d, "claim", claimable, (key) => d.submitClaim(a, key));
      if (f.pending) return f;
    }
  }

  const owed = BigInt(f.owedTreasury6);
  if (owed >= d.minTreasury6) f = await run(a, f, d, "treasury", owed, (key) => d.submitTreasury(a, owed, key));
  return f;
}
