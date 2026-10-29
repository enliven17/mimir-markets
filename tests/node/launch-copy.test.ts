import assert from "node:assert/strict";
import { test } from "node:test";

import {
  arcCopyAmount, COPY_MAX_SLIPPAGE_BPS, createMirror, drainCopies, keepStoredWallet, reconcileCopyBuy, runArcCopy, runSolBuy, runSolSell,
  type ArcCopyDeps, type ArcSubRow, type CopyJobStore, type SolJob, type SolSubRow,
} from "../../lib/launch/worker/copy";
import { silentLog } from "../../lib/launch/worker/log";

const fill = (lamports: bigint, tokens: bigint) => ({ sig: "s", lamports, tokens, decimals: 6 });
const sub = (over: Partial<SolSubRow> = {}): SolSubRow => ({ id: "s1", follower: "F", walletId: "cw", wallet: "CW", maxPerTradeLamports: 100_000_000n, active: true, on: true, ...over });

/** An in-memory job store: keys run once, positions per sub+mint, job statuses kept for asserts. */
function jobStore(s: SolSubRow | null = sub()) {
  const jobs = new Map<string, { status: string; sig?: string; note?: string }>();
  const pos = new Map<string, bigint>();
  const store: CopyJobStore = {
    claim: async (key) => (jobs.has(key) ? false : (jobs.set(key, { status: "running" }), true)),
    solSub: async () => s,
    held: async (id, mint) => pos.get(`${id}:${mint}`) ?? 0n,
    buySigned: async (key, _m, sig) => void (jobs.get(key)!.sig = sig),
    addFill: async (key, id, mint, tokens) => {
      if (jobs.get(key)?.status === "done") return;
      jobs.set(key, { ...jobs.get(key), status: "done" });
      pos.set(`${id}:${mint}`, (pos.get(`${id}:${mint}`) ?? 0n) + tokens);
    },
    settleSell: async (id, mint, _h, left) => void (left > 0n ? pos.set(`${id}:${mint}`, left) : pos.delete(`${id}:${mint}`)),
    finish: async (key, status, note) => void jobs.set(key, { ...jobs.get(key), status, note }),
  };
  return { store, jobs, pos };
}
const buyJob = (key = "s1:buy:agentSig", slippageBps = 100): Extract<SolJob, { kind: "buy" }> => ({ kind: "buy", key, sub: "s1", mint: "M", slippageBps });

// ---------------- fan-out ----------------

test("fan-out: one job per follower, keyed on the agent's signature, slippage capped; sells reach holders", async () => {
  const jobs: SolJob[] = [];
  const m = createMirror({ solSubs: async () => [{ id: "a" }, { id: "b" }], holders: async () => [{ id: "c" }], schedule: async (j) => void jobs.push(j) }, silentLog);
  await m.buy("agent", "MINT", 4_900, "SIG1");
  await m.sell("agent", "MINT", 0.5, 200, "SIG2");
  assert.equal(COPY_MAX_SLIPPAGE_BPS, 300);
  assert.deepEqual(jobs.map((j) => [j.kind, j.key, j.slippageBps]), [["buy", "a:buy:SIG1", 300], ["buy", "b:buy:SIG1", 300], ["sell", "c:sell:SIG2", 200]]);
});

// ---------------- Solana jobs ----------------

test("a copy buy is capped by the follower's max and the wallet, skipped under 0.01 SOL, and runs once per key", async () => {
  const spent: bigint[] = [];
  const exec = (have: bigint) => ({ buy: async (a: { lamports: bigint }) => (spent.push(a.lamports), fill(a.lamports, 5n)), sell: async () => fill(1n, 1n), spendable: async () => have });
  const j = jobStore();
  assert.equal(await runSolBuy(j.store, exec(1_000_000_000n), silentLog, buyJob("k1")), "done");
  assert.equal(await runSolBuy(j.store, exec(1_000_000_000n), silentLog, buyJob("k1")), "skipped"); // same agent fill again
  assert.equal(await runSolBuy(j.store, exec(40_000_000n), silentLog, buyJob("k2")), "done");
  assert.equal(await runSolBuy(j.store, exec(5_000_000n), silentLog, buyJob("k3")), "skipped");
  assert.deepEqual(spent, [100_000_000n, 40_000_000n]);
  assert.equal(j.pos.get("s1:M"), 10n);
});

test("M2: a copy buy stores its signature before broadcast; an ambiguous failure is unknown, a provable one failed", async () => {
  const j = jobStore();
  const ambiguous = {
    buy: async (a: { onSigned?: (s: string, l: number) => Promise<void> }) => { await a.onSigned?.("COPYSIG", 9); throw Object.assign(new Error("timeout"), { name: "AmbiguousSendError" }); },
    sell: async () => fill(1n, 1n), spendable: async () => 1_000_000_000n,
  };
  assert.equal(await runSolBuy(j.store, ambiguous, silentLog, buyJob("amb")), "unknown");
  assert.equal(j.jobs.get("amb")?.sig, "COPYSIG");
  const rejected = { ...ambiguous, buy: async () => { throw Object.assign(new Error("preflight"), { notLanded: true }); } };
  assert.equal(await runSolBuy(j.store, rejected, silentLog, buyJob("rej")), "failed");
});

test("M2: an unrecorded copy buy is settled by signature: landed adds what it really bought, once", async () => {
  const j = jobStore();
  await j.store.claim("k", "s1", "buy");
  const row = { key: "k", sub: "s1", mint: "M", sig: "S", lastValidBlockHeight: 1 };
  assert.equal(await reconcileCopyBuy(row, async () => "unknown", async () => ({ tokens: 9n, lamports: 1n }), j.store), "open");
  assert.equal(await reconcileCopyBuy(row, async () => "landed", async () => ({ tokens: 9n, lamports: 1n }), j.store), "done");
  assert.equal(await reconcileCopyBuy(row, async () => "landed", async () => ({ tokens: 9n, lamports: 1n }), j.store), "done");
  assert.equal(j.pos.get("s1:M"), 9n);
  await j.store.claim("k2", "s1", "buy");
  assert.equal(await reconcileCopyBuy({ ...row, key: "k2" }, async () => "notLanded", async () => ({ tokens: 0n, lamports: 0n }), j.store), "failed");
});

test("a sell mirrors the same fraction of what the follower holds, all of it at 1, paused followers included", async () => {
  const j = jobStore(sub({ active: false }));
  j.pos.set("s1:M", 1_000n);
  const sold: bigint[] = [];
  const exec = { buy: async () => fill(1n, 1n), sell: async (a: { tokens: bigint }) => (sold.push(a.tokens), fill(1n, a.tokens)), spendable: async () => 0n };
  await runSolSell(j.store, exec, silentLog, { kind: "sell", key: "x1", sub: "s1", mint: "M", fraction: 0.25, slippageBps: 100 });
  await runSolSell(j.store, exec, silentLog, { kind: "sell", key: "x2", sub: "s1", mint: "M", fraction: 1, slippageBps: 100 });
  assert.deepEqual(sold, [250n, 750n]);
  assert.equal(j.pos.has("s1:M"), false);
});

test("M2 drain: sells the copy wallet's actual on-chain balance of every copied mint, then clears the rows", async () => {
  const sold: Array<[string, bigint]> = [];
  const settled: string[] = [];
  const n = await drainCopies(
    { settleSell: async (_id, mint) => void settled.push(mint) },
    { sell: async (a) => (sold.push([a.mint, a.tokens]), fill(1n, a.tokens)), tokenBalance: async (_w, mint) => (mint === "A" ? 42n : 0n) },
    { id: "s1", walletId: "cw", wallet: "CW" },
    ["A", "B"],
  );
  assert.equal(n, 1);
  assert.deepEqual(sold, [["A", 42n]]);
  assert.deepEqual(settled, ["A", "B"]);
});

test("M1: a stored copy wallet is never replaced, only its settings change", () => {
  const stored = { walletId: "w1", address: "A1", maxPerStakeUsdc: 1, on: false };
  const racing = { walletId: "w2", address: "A2", maxPerStakeUsdc: 5, on: true };
  assert.deepEqual(keepStoredWallet(stored, racing), { walletId: "w1", address: "A1", maxPerStakeUsdc: 5, on: true });
  assert.deepEqual(keepStoredWallet(undefined, racing), racing);
  assert.deepEqual(keepStoredWallet(stored, undefined), stored);
});

// ---------------- Arc jobs ----------------

test("arc copy amount: the cap within the balance minus gas, in cents, 0 under the pool minimum", () => {
  assert.equal(arcCopyAmount(5, 100, 0.1), 5);
  assert.equal(arcCopyAmount(5, 2.059, 0.1), 2);
  assert.equal(arcCopyAmount(5, 0.12, 0.1), 0);
});

test("arc copy job: runs once, a Circle error is unknown (never retried)", async () => {
  const subs: Record<string, ArcSubRow> = {
    a: { id: "a", follower: "A", walletId: "wa", wallet: "A", maxPerStakeUsdc: 3, active: true, on: true },
    c: { id: "c", follower: "C", walletId: "wc", wallet: "C", maxPerStakeUsdc: 3, active: true, on: true },
    e: { id: "e", follower: "E", walletId: "we", wallet: "E", maxPerStakeUsdc: 3, active: true, on: true },
  };
  const j = jobStore();
  const staked: string[] = [];
  const d: ArcCopyDeps = {
    store: { ...j.store, arcSub: async (id) => subs[id] ?? null },
    balanceUsdc: async () => 10,
    stake: async (a) => {
      if (a.walletId === "we") throw new Error("Circle tx did not confirm");
      staked.push(`${a.walletId}:${a.marketId}:${a.side}:${a.amountUsdc}`);
      return "0xtx";
    },
    log: silentLog,
    minStakeUsdc: 0.1,
  };
  assert.equal(await runArcCopy(d, { key: "a:arc:T", sub: "a", marketId: 7, side: 2 }), "done");
  assert.equal(await runArcCopy(d, { key: "a:arc:T", sub: "a", marketId: 7, side: 2 }), "skipped");
  assert.equal(await runArcCopy(d, { key: "c:arc:T", sub: "c", marketId: 7, side: 2 }), "done");
  assert.equal(await runArcCopy(d, { key: "e:arc:T", sub: "e", marketId: 7, side: 2 }), "unknown");
  assert.deepEqual(staked, ["wa:7:2:3", "wc:7:2:3"]);
});
