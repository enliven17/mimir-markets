/**
 * Mimir Launch reconciler core (ported from snipad worker/reconcile.ts): settles creator payouts and treasury transfers
 * whose outcome a crashed or timed-out fee round never recorded, by signature (lib/launch/solana/tx.ts
 * settleSignature: "notLanded" only once the sticky endpoint is past lastValidBlockHeight + margin AND a second
 * endpoint has no record either). Anything else stays open: nothing is ever re-paid on "unknown". Airdrop batches
 * settle themselves (lib/launch/airdrop.ts). Runtime-agnostic; convex/launchFees.ts reconcileOne runs it under the
 * agent lease, so no job of that agent is mid-flight.
 */
import type { Settlement } from "./solana/tx";

export type Unresolved = {
  kind: "payout" | "treasury";
  id: string;
  agent: string;
  sig: string | null;
  lastValidBlockHeight: number | null;
  status: "sending" | "unknown";
};

/** "failed" means provably not landed: a payout goes back to the creator pool, a treasury transfer is owed again. */
export type ReconcileStore = {
  payout(id: string, outcome: "sent" | "failed", sig?: string): Promise<void>;
  treasury(id: string, outcome: "sent" | "failed", sig?: string): Promise<void>;
};

export type Settle = (sig: string, lastValidBlockHeight: number) => Promise<Settlement>;

export async function reconcileItem(u: Unresolved, settle: Settle, store: ReconcileStore): Promise<"sent" | "failed" | "open"> {
  const write = (o: "sent" | "failed", sig?: string) => store[u.kind](u.id, o, sig);
  if (!u.sig) {
    // The signature is stored before the first broadcast, and we hold the agent lease: a "sending" row without one
    // never reached the wire. An "unknown" row without one needs a human.
    if (u.status !== "sending") return "open";
    await write("failed");
    return "failed";
  }
  const s = await settle(u.sig, u.lastValidBlockHeight ?? Number.MAX_SAFE_INTEGER);
  if (s === "landed") {
    await write("sent", u.sig);
    return "sent";
  }
  if (s === "failed" || s === "notLanded") {
    await write("failed");
    return "failed";
  }
  return "open";
}
