"use node";

// Mimir Launch: an agent's creator fees as Node actions (ported from snipad convex/worker/{fees,airdrop}.ts). Fee
// round: claim pump.fun creator fees and split them (lib/launch/fees.ts), then pay what is owed. Airdrop: plan or
// resume a holder round (lib/launch/airdrop.ts). Snapshot: one read-only holder snapshot. Anything that spends from
// the agent wallet holds the agent's lease (launchSolDb.acquire) so no tick or withdrawal spends meanwhile; a busy
// lease retries a few seconds later. Env: LAUNCH_FEES=1, the Solana env lib/launch/solana/env.ts reads, optional
// HELIUS_API_KEYS (holder snapshots via DAS), LAUNCH_FEE_MIN_CLAIM_LAMPORTS, LAUNCH_PAYOUT_MIN_LAMPORTS,
// HOLDER_AIRDROP_MIN_LAMPORTS, HOLDER_AIRDROP_MAX, HOLDER_AIRDROP_DUST_BPS.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { airdropSettings, batches, runAirdrop, takeSnapshot, type AirdropStore } from "../lib/launch/airdrop";
import { createAirdropChain } from "../lib/launch/airdrop-chain";
import { vaultBalance } from "../lib/launch/fee-vault";
import { feeForAgent, payOwed, type FeeDeps, type FeeStore } from "../lib/launch/fees";
import { solanaFromEnv } from "../lib/launch/solana/env";
import { lockOwnMint } from "../lib/launch/solana/locks";
import { fetchConfirmedTx, settleSignature, walletDeltas, type Settlement } from "../lib/launch/solana/tx";
import { reconcileItem, type ReconcileStore } from "../lib/launch/reconcile";
import { heliusClient, heliusKeys } from "../lib/launch/solana/rpc-pool";
import { createConsoleLogger, publicError } from "../lib/launch/worker/log";

const log = createConsoleLogger({ level: process.env.LOG_LEVEL, base: { svc: "launch-fees" } });
const MAX_ATTEMPTS = 6;
const RETRY_MS = 5_000;
const gated = () => process.env.MIMIR_BACKEND_OFF === "1" || process.env.LAUNCH_FEES !== "1";

const lamportsVar = (name: string, fallback: bigint) => {
  const raw = process.env[name]?.trim();
  return raw && /^\d{1,15}$/.test(raw) && BigInt(raw) > 0n ? BigInt(raw) : fallback;
};

function build() {
  const solana = solanaFromEnv(process.env, { onRetry: (e: unknown) => log.warn("solana retry", { event: e }) });
  return {
    solana,
    helius: heliusKeys(process.env).length ? heliusClient(process.env) : null,
    minClaimLamports: lamportsVar("LAUNCH_FEE_MIN_CLAIM_LAMPORTS", 20_000_000n),
    creatorPayoutMinLamports: lamportsVar("LAUNCH_PAYOUT_MIN_LAMPORTS", 10_000_000n),
    airdrop: airdropSettings(process.env),
  };
}
let cached: ReturnType<typeof build> | null = null;
const deps = () => (cached ??= build());

/** Runs `fn` holding the agent's lease; `{ ran: false }` when a tick or another job holds it. Always releases. */
async function withLease<T>(ctx: ActionCtx, id: Id<"launchAgents">, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const token = await ctx.runMutation(internal.launchSolDb.acquire, { id });
  if (token === null) return { ran: false };
  try {
    return { ran: true, value: await fn() };
  } finally {
    await ctx.runMutation(internal.launchSolDb.release, { id, token });
  }
}

function feeStore(ctx: ActionCtx): FeeStore {
  const aid = (id: string) => id as Id<"launchAgents">;
  return {
    markClaimed: async (id) => void (await ctx.runMutation(internal.launchFeeDb.markClaimed, { id: aid(id) })),
    claimSigned: async (id, sig, lastValidBlockHeight) => void (await ctx.runMutation(internal.launchFeeDb.claimSigned, { id: aid(id), sig, lastValidBlockHeight })),
    clearPendingClaim: async (id, sig) => void (await ctx.runMutation(internal.launchFeeDb.clearPendingClaim, { id: aid(id), sig })),
    recordClaim: (id, c) => ctx.runMutation(internal.launchFeeDb.recordClaim, { id: aid(id), lamports: c.lamports, split: c.split, allocation: c.allocation, accrue: c.accrue, sig: c.sig }),
    recordBurn: async (id, b) => void (await ctx.runMutation(internal.launchFeeDb.recordBurn, { id: aid(id), ...b })),
    event: async (id, kind, text) => void (await ctx.runMutation(internal.launchFeeDb.event, { id: aid(id), kind, text })),
    beginCreatorPayout: async (id, lamports) => (await ctx.runMutation(internal.launchFeeDb.beginCreatorPayout, { id: aid(id), lamports })) as string | null,
    payoutSigned: async (payout, sig, lastValidBlockHeight) => void (await ctx.runMutation(internal.launchFeeDb.payoutSigned, { payout: payout as Id<"launchPayouts">, sig, lastValidBlockHeight })),
    finishCreatorPayout: async (payout, r) => void (await ctx.runMutation(internal.launchFeeDb.finishCreatorPayout, { payout: payout as Id<"launchPayouts">, ...r })),
    owedTreasury: (id) => ctx.runQuery(internal.launchFeeDb.owedTreasury, { id: aid(id) }),
    treasurySigned: async (t, sig, lastValidBlockHeight) => void (await ctx.runMutation(internal.launchFeeDb.treasurySigned, { transfer: t as Id<"launchTreasuryTransfers">, sig, lastValidBlockHeight })),
    finishTreasury: async (t, r) => void (await ctx.runMutation(internal.launchFeeDb.finishTreasury, { transfer: t as Id<"launchTreasuryTransfers">, ...r })),
  };
}

function airdropStore(ctx: ActionCtx): AirdropStore {
  const aid = (id: string) => id as Id<"launchAgents">;
  const bid = (id: string) => id as Id<"launchHolderBatches">;
  return {
    openRound: (id) => ctx.runQuery(internal.launchFeeDb.openRound, { id: aid(id) }),
    createRound: (id, plan, size) =>
      ctx.runMutation(internal.launchFeeDb.createRound, { id: aid(id), total: plan.total, recipients: plan.recipients.length, batches: batches(plan.recipients.map((x) => ({ to: x.to, lamports: x.lamports })), size) }),
    markSending: async (b, sig, lastValidBlockHeight) => void (await ctx.runMutation(internal.launchFeeDb.markSending, { batch: bid(b), sig, lastValidBlockHeight })),
    markBatch: (b, status, sig) => ctx.runMutation(internal.launchFeeDb.markBatch, { batch: bid(b), status, ...(sig ? { sig } : {}) }),
    splitBatch: async (b) => void (await ctx.runMutation(internal.launchFeeDb.splitBatch, { batch: bid(b) })),
    dropBatch: async (b, reason) => void (await ctx.runMutation(internal.launchFeeDb.dropBatch, { batch: bid(b), reason })),
    priorSnapshot: async (id, from, to, pick) => {
      const rows = await ctx.runQuery(internal.launchFeeDb.priorSnapshot, { id: aid(id), from, to, pick });
      return rows ? new Map(rows.map((x) => [x.owner, x.amount])) : null;
    },
    saveSnapshot: async (id, at, balances) => void (await ctx.runMutation(internal.launchFeeDb.saveSnapshot, { id: aid(id), at, balances })),
    releaseHoldersPool: async (id) => void (await ctx.runMutation(internal.launchFeeDb.releaseHoldersPool, { id: aid(id) })),
    policyWidened: async (id, open) => void (await ctx.runMutation(internal.launchFeeDb.policyWidened, { id: aid(id), open })),
    finishRound: async (round) => void (await ctx.runMutation(internal.launchFeeDb.finishRound, { round: round as Id<"launchHolderRounds"> })),
    event: async (id, kind, text) => void (await ctx.runMutation(internal.launchFeeDb.event, { id: aid(id), kind, text })),
  };
}

const chainFor = (d: ReturnType<typeof deps>) =>
  createAirdropChain({ connection: d.solana.connection, helius: d.helius, executor: d.solana.executor, privy: d.solana.privy, endpoints: d.solana.sticky });

/** Fee round: claim and split; with nothing new, still pay what is owed (treasury, a creator pool at the minimum). */
export const feeOne = internalAction({
  args: { id: v.id("launchAgents"), attempt: v.optional(v.number()) },
  handler: async (ctx, { id, attempt = 0 }): Promise<string> => {
    if (gated()) return "gated";
    try {
      const out = await withLease(ctx, id, async () => {
        const a = await ctx.runQuery(internal.launchFeeDb.feeAgent, { id });
        if (!a) return "skipped";
        lockOwnMint(a.wallet, a.mint);
        const d = deps();
        const fd: FeeDeps = {
          store: feeStore(ctx), executor: d.solana.executor, accrued: (w) => (a.pad === "meteora" ? (d.solana.meteora?.accrued(a.mint) ?? Promise.resolve(null)) : vaultBalance(d.solana.connection, w)), treasury: d.solana.treasury,
          minClaimLamports: d.minClaimLamports, creatorPayoutMinLamports: d.creatorPayoutMinLamports, log,
          settleClaim: (sig, lvbh, wallet) => settleClaim(d, sig, lvbh, wallet),
        };
        const claimed = await feeForAgent(a, fd);
        if (claimed === 0n) {
          const fresh = await ctx.runQuery(internal.launchFeeDb.feeAgent, { id });
          if (fresh) await payOwed(fresh, fd).catch((err) => log.error("owed payouts failed", { agentId: id, err }));
        }
        return claimed > 0n ? "claimed" : "nothing";
      });
      if (out.ran) return out.value;
      if (attempt + 1 < MAX_ATTEMPTS) await ctx.scheduler.runAfter(RETRY_MS, internal.launchFees.feeOne, { id, attempt: attempt + 1 });
      return "busy";
    } catch (err) {
      log.error("fee action failed", { agentId: id, err });
      return "failed";
    }
  },
});

/** A claim signed in an earlier round but never booked: where it stands, and what it brought in when it landed. */
async function settleClaim(d: ReturnType<typeof deps>, sig: string, lastValidBlockHeight: number, wallet: string): Promise<{ state: Settlement; lamports: bigint }> {
  const ep = d.solana.sticky.pickEndpoint();
  if (!ep) return { state: "unknown", lamports: 0n };
  const { state } = await settleSignature(ep.connection, ep.witnesses, sig, lastValidBlockHeight);
  if (state !== "landed") return { state, lamports: 0n };
  return { state, lamports: walletDeltas(await fetchConfirmedTx(ep.connection, sig), wallet, null).lamports };
}

/** Settles one agent's payouts and treasury transfers left in sending/unknown, by signature, under its lease. */
export const reconcileOne = internalAction({
  args: { id: v.id("launchAgents"), attempt: v.optional(v.number()) },
  handler: async (ctx, { id, attempt = 0 }): Promise<string> => {
    if (gated()) return "gated";
    try {
      const out = await withLease(ctx, id, async () => {
        const items = await ctx.runQuery(internal.launchFeeDb.unresolvedFor, { id });
        const ep = deps().solana.sticky.pickEndpoint();
        if (!ep) return "no endpoint";
        const settle = async (sig: string, lvbh: number) => (await settleSignature(ep.connection, ep.witnesses, sig, lvbh)).state;
        const store: ReconcileStore = {
          payout: async (pid, outcome, sig) => void (await ctx.runMutation(internal.launchFeeDb.finishCreatorPayout, { payout: pid as Id<"launchPayouts">, status: outcome, ...(sig ? { sig } : {}) })),
          treasury: async (tid, outcome, sig) =>
            void (await ctx.runMutation(internal.launchFeeDb.finishTreasury, { transfer: tid as Id<"launchTreasuryTransfers">, status: outcome === "sent" ? "sent" : "pending", ...(sig ? { sig } : {}) })),
        };
        let settled = 0;
        for (const u of items) {
          const r = await reconcileItem(u, settle, store);
          if (r !== "open") {
            settled++;
            log.info("reconciled", { agentId: id, kind: u.kind, id: u.id, outcome: r, sig: u.sig });
          }
        }
        return `settled ${settled}/${items.length}`;
      });
      if (out.ran) return out.value;
      if (attempt + 1 < MAX_ATTEMPTS) await ctx.scheduler.runAfter(RETRY_MS, internal.launchFees.reconcileOne, { id, attempt: attempt + 1 });
      return "busy";
    } catch (err) {
      log.error("reconcile action failed", { agentId: id, err });
      return "failed";
    }
  },
});

/** Holder airdrop: plan a due round or resume an open one, under the lease. A failed payment leaves it resumable. */
export const airdropOne = internalAction({
  args: { id: v.id("launchAgents"), attempt: v.optional(v.number()) },
  handler: async (ctx, { id, attempt = 0 }): Promise<string> => {
    if (gated()) return "gated";
    try {
      const out = await withLease(ctx, id, async () => {
        const a = await ctx.runQuery(internal.launchFeeDb.airdropAgent, { id });
        if (!a) return "skipped";
        lockOwnMint(a.wallet, a.mint);
        const d = deps();
        const store = airdropStore(ctx);
        try {
          return await runAirdrop({ ...a, treasury: d.solana.treasury }, { store, chain: chainFor(d), ...d.airdrop, log });
        } catch (err) {
          log.error("airdrop round failed", { agentId: id, err });
          await store.event(id, "error", `holder airdrop paused: ${publicError(err)}; it resumes where it stopped`).catch(() => undefined);
          return "failed";
        }
      });
      if (out.ran) return out.value;
      if (attempt + 1 < MAX_ATTEMPTS) await ctx.scheduler.runAfter(RETRY_MS, internal.launchFees.airdropOne, { id, attempt: attempt + 1 });
      return "busy";
    } catch (err) {
      log.error("airdrop action failed", { agentId: id, err });
      return "failed";
    }
  },
});

/** One periodic holder snapshot (read-only, no lease) for the anti-sniping minimum. */
export const snapshotOne = internalAction({
  args: { id: v.id("launchAgents") },
  handler: async (ctx, { id }): Promise<string> => {
    if (gated()) return "gated";
    try {
      const a = await ctx.runQuery(internal.launchFeeDb.airdropAgent, { id });
      if (!a) return "skipped";
      const d = deps();
      const n = await takeSnapshot({ ...a, treasury: d.solana.treasury }, { store: airdropStore(ctx), chain: chainFor(d), ...d.airdrop, log });
      return `saved ${n}`;
    } catch (err) {
      log.warn("holder snapshot failed", { agentId: id, err });
      return "failed";
    }
  },
});
