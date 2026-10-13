import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOCATION_DELAY_MS, allocationProblem, BUYBACK_MAX_SLIPPAGE_BPS, claimAndSplit, DEFAULT_ALLOCATION, effectiveAllocation, feeForAgent, payCreator, payOwed,
  PLATFORM_FEES, splitClaim, type FeeAgent, type FeeDeps, type FeeExecutor, type FeeStore,
} from "../../lib/launch/fees";
import { silentLog } from "../../lib/launch/worker/log";

const TREASURY = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CREATOR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL = 1_000_000_000n;
/** snipad's default split: the flow tests below keep their numbers with it. */
const SPLIT = { bankroll: 50, buyback: 30, creatorPayout: 20, holders: 0 };

function fakeExec(claimed: bigint, opts: { failBuy?: boolean; failTransferTo?: string; transferError?: Error; signedSig?: string } = {}) {
  const calls: string[] = [];
  const buys: Record<string, unknown>[] = [];
  const executor: FeeExecutor = {
    async claimCreatorFees() { calls.push("claim"); return { sig: "claim-1", lamports: claimed }; },
    async transferSol(a) {
      const sig = opts.signedSig ?? `t-${a.to.slice(0, 4)}`;
      await a.onSigned?.(sig, 777);
      if (a.to === opts.failTransferTo) throw opts.transferError ?? new Error("boom");
      calls.push(`transfer:${a.to}:${a.lamports}`);
      return sig;
    },
    async buy(a) { buys.push(a); if (opts.failBuy) throw new Error("no route"); calls.push(`buy:${a.mint}:${a.lamports}`); return { sig: "b1", lamports: a.lamports, tokens: 777n, decimals: 6 }; },
    async burn(a) { calls.push(`burn:${a.tokens}`); return "burn1"; },
    async spendable() { return 5n * SOL; },
  };
  return { executor, calls, buys };
}

function memStore(pools = { creatorPool: 0n, holdersPool: 0n }) {
  const log: string[] = [];
  const state = {
    ...pools,
    payouts: [] as { id: string; lamports: bigint; status: string; sig?: string; lvbh?: number }[],
    treasury: [] as { id: string; lamports: bigint; status: string; sig?: string }[],
  };
  const store: FeeStore = {
    async markClaimed(id) { log.push(`marked:${id}`); },
    async claimSigned(id, sig) { log.push(`claim-signed:${sig}`); },
    async clearPendingClaim(id, sig) { log.push(`claim-cleared:${sig}`); },
    async recordClaim(id, c) {
      log.push(`claim:${id}:${c.lamports}:${c.split.bankroll}:${c.accrue}`);
      const owed = c.split.platform + c.split.llm;
      if (owed > 0n && !state.treasury.some((t) => t.id === `tr-${c.sig}`)) state.treasury.push({ id: `tr-${c.sig}`, lamports: owed, status: "pending" });
      if (c.accrue) {
        state.creatorPool += c.split.creatorPayout;
        state.holdersPool += c.split.holders;
      }
      return { creatorPool: state.creatorPool, holdersPool: state.holdersPool };
    },
    async recordBurn(id, b) { log.push(`burn:${id}:${b.tokens}`); },
    async event(id, kind) { log.push(`event:${kind}`); },
    async beginCreatorPayout(id, lamports) {
      if (state.payouts.some((p) => p.status === "sending" || p.status === "unknown") || lamports > state.creatorPool) return null;
      state.creatorPool -= lamports;
      const p = { id: `p${state.payouts.length + 1}`, lamports, status: "sending" };
      state.payouts.push(p);
      log.push(`payout:${id}:${lamports}`);
      return p.id;
    },
    async payoutSigned(pid, sig, lvbh) {
      const p = state.payouts.find((x) => x.id === pid)!;
      Object.assign(p, { sig, lvbh });
      log.push(`payout-signed:${sig}`);
    },
    async finishCreatorPayout(pid, r) {
      const p = state.payouts.find((x) => x.id === pid)!;
      p.status = r.status;
      if (r.sig) p.sig = r.sig;
      if (r.status === "failed") state.creatorPool += p.lamports;
      log.push(`payout-${r.status}`);
    },
    async owedTreasury() { return state.treasury.filter((t) => t.status === "pending").map((t) => ({ id: t.id, lamports: t.lamports })); },
    async treasurySigned(tid, sig) { const t = state.treasury.find((x) => x.id === tid)!; Object.assign(t, { status: "sending", sig }); log.push("treasury-signed"); },
    async finishTreasury(tid, r) { const t = state.treasury.find((x) => x.id === tid)!; t.status = r.status; if (r.sig) t.sig = r.sig; log.push(`treasury-${r.status}`); },
  };
  return { store, log, state };
}

const agent = (over: Partial<FeeAgent> = {}): FeeAgent => ({
  id: "aa", ticker: "AA", mint: "Mintaa", creator: CREATOR, walletId: "pw-aa", wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  status: "live", feesClaimedAt: null, slippageBps: 300, allocation: SPLIT, pendingAllocation: null, creatorPool: 0n, ...over,
});
const deps = (executor: FeeExecutor, store: FeeStore, accrued: bigint | null = SOL): FeeDeps =>
  ({ store, executor, accrued: async () => accrued, treasury: TREASURY, minClaimLamports: 20_000_000n, creatorPayoutMinLamports: 10_000_000n, log: silentLog });

// ---------------- allocation rules ----------------

test("platform takes a fixed 10% + 10% (AI costs); default allocation sums to 100", () => {
  assert.deepEqual(PLATFORM_FEES, { platformPct: 10, llmPct: 10 });
  assert.equal(allocationProblem(DEFAULT_ALLOCATION), null);
  assert.deepEqual(DEFAULT_ALLOCATION, { bankroll: 60, buyback: 20, creatorPayout: 20, holders: 0 });
});

test("allocation must be four integer percents summing to 100", () => {
  assert.equal(allocationProblem({ bankroll: 25, buyback: 25, creatorPayout: 25, holders: 25 }), null);
  assert.equal(allocationProblem({ bankroll: 100, buyback: 0, creatorPayout: 0, holders: 0 }), null);
  assert.match(allocationProblem({ bankroll: 50, buyback: 30, creatorPayout: 20, holders: 1 }) ?? "", /sum to 100/);
  assert.match(allocationProblem({ bankroll: 50.5, buyback: 29.5, creatorPayout: 20, holders: 0 }) ?? "", /whole/);
  assert.match(allocationProblem({ bankroll: 110, buyback: -10, creatorPayout: 0, holders: 0 }) ?? "", /0 to 100/);
  assert.match(allocationProblem({ bankroll: 100, buyback: 0, creatorPayout: 0 } as never) ?? "", /holders/);
  assert.match(allocationProblem({ bankroll: 50, buyback: 50, creatorPayout: 0, holders: 0, rug: 0 } as never) ?? "", /rug/);
});

test("claim math: 10% platform, 10% llm, the 80% split by allocation, rounding dust to the bankroll", () => {
  const s = splitClaim(SOL, SPLIT);
  assert.deepEqual(s, { platform: 100_000_000n, llm: 100_000_000n, bankroll: 400_000_000n, buyback: 240_000_000n, creatorPayout: 160_000_000n, holders: 0n });
  // 1_000_000_007 lamports with odd percents: every part floors, the bankroll takes what is left.
  const odd = splitClaim(1_000_000_007n, { bankroll: 1, buyback: 33, creatorPayout: 33, holders: 33 });
  const sum = odd.platform + odd.llm + odd.bankroll + odd.buyback + odd.creatorPayout + odd.holders;
  assert.equal(sum, 1_000_000_007n);
  assert.equal(odd.platform, 100_000_000n);
  assert.equal(odd.llm, 100_000_000n);
  assert.equal(odd.buyback, 264_000_002n); // floor(800_000_007 * 33 / 100)
  assert.equal(odd.bankroll, 800_000_007n - 3n * 264_000_002n);
  // tiny claims: nothing negative, all dust in the bankroll
  assert.deepEqual(splitClaim(7n, SPLIT), { platform: 0n, llm: 0n, bankroll: 4n, buyback: 2n, creatorPayout: 1n, holders: 0n });
  assert.throws(() => splitClaim(SOL, { bankroll: 50, buyback: 50, creatorPayout: 50, holders: 0 }));
});

test("24h switch: a pending change applies only from effectiveAt; missing allocation = default", () => {
  const now = 1_800_000_000_000;
  const next = { bankroll: 70, buyback: 10, creatorPayout: 20, holders: 0 };
  const pending = { allocation: next, effectiveAt: now + ALLOCATION_DELAY_MS };
  assert.equal(ALLOCATION_DELAY_MS, 24 * 3600_000);
  assert.deepEqual(effectiveAllocation({ allocation: null, pendingAllocation: null }, now), DEFAULT_ALLOCATION);
  assert.deepEqual(effectiveAllocation({ allocation: null, pendingAllocation: pending }, now), DEFAULT_ALLOCATION);
  assert.deepEqual(effectiveAllocation({ allocation: null, pendingAllocation: pending }, now + ALLOCATION_DELAY_MS - 1), DEFAULT_ALLOCATION);
  assert.deepEqual(effectiveAllocation({ allocation: null, pendingAllocation: pending }, now + ALLOCATION_DELAY_MS), next);
});

// ---------------- the claim flow ----------------

test("claim → treasury gets platform+llm in one transfer → buyback burned → creator share accrues → all recorded", async () => {
  const { executor, calls } = fakeExec(SOL);
  const { store, log, state } = memStore();
  // 0.16 SOL creator share ≥ 0.01 SOL minimum: paid out in the same round.
  assert.equal(await claimAndSplit(agent(), deps(executor, store)), SOL);
  assert.deepEqual(calls, ["claim", `transfer:${TREASURY}:200000000`, "buy:Mintaa:240000000", "burn:777", `transfer:${CREATOR}:160000000`]);
  assert.deepEqual(log, ["marked:aa", "claim:aa:1000000000:400000000:true", "event:fee", "treasury-signed", "treasury-sent", "burn:aa:777", "event:burn", "payout:aa:160000000", `payout-signed:t-${CREATOR.slice(0, 4)}`, "payout-sent", "event:fee"]);
  assert.deepEqual(state.treasury.map((t) => [t.lamports, t.status]), [[200_000_000n, "sent"]]);
  assert.equal(state.creatorPool, 0n);
  assert.equal(state.payouts[0].sig, `t-${CREATOR.slice(0, 4)}`);
});

test("the claim uses the allocation effective at claim time", async () => {
  const now = Date.now();
  const next = { bankroll: 0, buyback: 0, creatorPayout: 0, holders: 100 };
  const { executor, calls } = fakeExec(SOL);
  const { store, state } = memStore();
  await claimAndSplit(agent({ pendingAllocation: { allocation: next, effectiveAt: now - 1 } }), deps(executor, store), now);
  assert.deepEqual(calls, ["claim", `transfer:${TREASURY}:200000000`]); // no buyback, no payout
  assert.equal(state.holdersPool, 800_000_000n);
  const { executor: e2, calls: c2 } = fakeExec(SOL);
  await claimAndSplit(agent({ pendingAllocation: { allocation: next, effectiveAt: now + 1 } }), deps(e2, memStore().store), now);
  assert.ok(c2.includes("buy:Mintaa:240000000"), "pending change not yet effective: the current split applies");
});

test("creator payout waits for the minimum and never runs twice in flight", async () => {
  const { executor, calls } = fakeExec(0n);
  const { store, state } = memStore({ creatorPool: 9_999_999n, holdersPool: 0n });
  assert.equal(await payCreator(agent({ creatorPool: 9_999_999n }), deps(executor, store)), 0n);
  assert.deepEqual(calls, []);
  state.creatorPool = 10_000_000n;
  assert.equal(await payCreator(agent({ creatorPool: 10_000_000n }), deps(executor, store)), 10_000_000n);
  assert.deepEqual(calls, [`transfer:${CREATOR}:10000000`]);
  // An earlier payout whose outcome is unknown blocks new ones until reconciled.
  state.payouts[0].status = "unknown";
  state.creatorPool = 50_000_000n;
  assert.equal(await payCreator(agent({ creatorPool: 50_000_000n }), deps(executor, store)), 0n);
  assert.equal(calls.length, 1);
});

test("creator payout that provably did not land goes back to the pool; an ambiguous one stays reserved", async () => {
  const notLanded = Object.assign(new Error("preflight rejected"), { notLanded: true });
  const { executor } = fakeExec(0n, { failTransferTo: CREATOR, transferError: notLanded });
  const { store, state } = memStore({ creatorPool: 20_000_000n, holdersPool: 0n });
  await assert.rejects(payCreator(agent({ creatorPool: 20_000_000n }), deps(executor, store)));
  assert.equal(state.creatorPool, 20_000_000n);
  assert.equal(state.payouts[0].status, "failed");

  const ambiguous = Object.assign(new Error("timed out"), { name: "AmbiguousSendError", sig: "amb-sig" });
  const { executor: e2 } = fakeExec(0n, { failTransferTo: CREATOR, transferError: ambiguous });
  const m = memStore({ creatorPool: 20_000_000n, holdersPool: 0n });
  await assert.rejects(payCreator(agent({ creatorPool: 20_000_000n }), deps(e2, m.store)));
  assert.equal(m.state.creatorPool, 0n);
  assert.deepEqual([m.state.payouts[0].status, m.state.payouts[0].sig], ["unknown", "amb-sig"]);
});

test("too little accrued → no claim tx at all; unknown accrual waits for the 24h schedule", async () => {
  const { executor, calls } = fakeExec(1n);
  const { store } = memStore();
  assert.equal(await claimAndSplit(agent(), deps(executor, store, 1_000n)), 0n);
  assert.equal(await claimAndSplit(agent({ feesClaimedAt: Date.now() - 3600_000 }), deps(executor, store, null)), 0n);
  assert.deepEqual(calls, []);
});

test("M6: a killed agent keeps the allocation in force: buyback burns, holders accrue, only the bankroll share goes to the creator", async () => {
  const { executor, calls } = fakeExec(SOL);
  const { store, log, state } = memStore();
  await claimAndSplit(agent({ status: "killed", allocation: { bankroll: 40, buyback: 20, creatorPayout: 20, holders: 20 } }), deps(executor, store));
  // 800M creator share: buyback 160M, holders 160M accrue, creatorPayout 160M + bankroll 320M = 480M paid out.
  assert.deepEqual(calls, ["claim", `transfer:${TREASURY}:200000000`, "buy:Mintaa:160000000", "burn:777", `transfer:${CREATOR}:480000000`]);
  assert.ok(log.includes("claim:aa:1000000000:0:true"), "recorded with no bankroll and accrued");
  assert.equal(state.holdersPool, 160_000_000n);
});

test("M6: the 24h delay still binds after a kill: a pending change does not apply early", async () => {
  const now = 1_800_000_000_000;
  const { executor, calls } = fakeExec(SOL);
  const { store } = memStore();
  const next = { bankroll: 0, buyback: 0, creatorPayout: 100, holders: 0 };
  await claimAndSplit(agent({ status: "killed", allocation: { bankroll: 0, buyback: 0, creatorPayout: 0, holders: 100 }, pendingAllocation: { allocation: next, effectiveAt: now + 1 } }), deps(executor, store), now);
  assert.deepEqual(calls, ["claim", `transfer:${TREASURY}:200000000`], "holders 100% in force: nothing goes to the creator");
});

test("M7: the creator payout's signature is recorded before broadcast", async () => {
  const { executor } = fakeExec(0n, { signedSig: "pay-sig" });
  const { store, log, state } = memStore({ creatorPool: 20_000_000n, holdersPool: 0n });
  await payCreator(agent({ creatorPool: 20_000_000n }), deps(executor, store));
  assert.deepEqual(log.slice(-3), ["payout-signed:pay-sig", "payout-sent", "event:fee"]);
  assert.deepEqual([state.payouts[0].sig, state.payouts[0].lvbh], ["pay-sig", 777]);
});

test("L1: the treasury share is owed until paid: a failed transfer stays owed (never bankroll) and is retried", async () => {
  const notLanded = Object.assign(new Error("preflight rejected"), { notLanded: true });
  const { executor } = fakeExec(SOL, { failTransferTo: TREASURY, transferError: notLanded });
  const m = memStore();
  await assert.rejects(claimAndSplit(agent(), deps(executor, m.store)));
  assert.deepEqual(m.state.treasury.map((t) => [t.lamports, t.status]), [[200_000_000n, "pending"]]);
  const { executor: ok, calls } = fakeExec(0n);
  await payOwed(agent(), deps(ok, m.store));
  assert.deepEqual(calls, [`transfer:${TREASURY}:200000000`]);
  assert.deepEqual(m.state.treasury.map((t) => t.status), ["sent"]);
});

test("L1: an ambiguous treasury transfer is left for the reconciler, never resent", async () => {
  const ambiguous = Object.assign(new Error("timed out"), { name: "AmbiguousSendError", sig: "amb" });
  const { executor } = fakeExec(SOL, { failTransferTo: TREASURY, transferError: ambiguous });
  const m = memStore();
  await assert.rejects(claimAndSplit(agent(), deps(executor, m.store)));
  assert.deepEqual(m.state.treasury.map((t) => [t.status, t.sig]), [["unknown", "amb"]]);
  const { executor: e2, calls } = fakeExec(0n);
  await payOwed(agent(), deps(e2, m.store));
  assert.deepEqual(calls, []);
});

test("L2 + H2: the buyback never uses more than the slippage cap and names the agent's own mint", async () => {
  const { executor, buys } = fakeExec(SOL);
  await claimAndSplit(agent({ slippageBps: 4_000 }), deps(executor, memStore().store));
  assert.equal(BUYBACK_MAX_SLIPPAGE_BPS, 300);
  assert.equal(buys[0].slippageBps, 300);
  assert.equal(buys[0].ownMint, "Mintaa");
});

test("feeForAgent never throws and reports the failure on the live view", async () => {
  const { executor } = fakeExec(500_000_000n, { failBuy: true });
  const { store, log } = memStore();
  assert.equal(await feeForAgent(agent(), deps(executor, store)), 0n);
  assert.equal(log.at(-1), "event:error");
});
