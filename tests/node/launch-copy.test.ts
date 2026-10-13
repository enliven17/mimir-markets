import assert from "node:assert/strict";
import { test } from "node:test";

import { arcCopyAmount, COPY_MAX_SLIPPAGE_BPS, createMirror, mirrorArcStake, type ArcCopyDeps, type CopyStore } from "../../lib/launch/worker/copy";
import { silentLog } from "../../lib/launch/worker/log";

const fill = (lamports: bigint, tokens: bigint) => ({ sig: "s", lamports, tokens, decimals: 6 });

function store(over: Partial<CopyStore> = {}): CopyStore {
  return {
    solSubs: async () => [{ id: "s1", follower: "F", walletId: "cw", wallet: "CW", maxPerTradeLamports: 100_000_000n }],
    holders: async () => [],
    addPosition: async () => undefined,
    settleSell: async () => undefined,
    pauseForGate: async () => undefined,
    ...over,
  };
}

test("a follower's copy buy never uses more slippage than the cap, whatever the agent set", async () => {
  const seen: number[] = [];
  const exec = { buy: async (a: { slippageBps: number }) => (seen.push(a.slippageBps), fill(1n, 1n)), sell: async () => fill(1n, 1n), spendable: async () => 1_000_000_000n };
  const mirror = createMirror(store(), exec, silentLog, async () => true);
  await mirror.buy("agent", "MINT", 4_900);
  await mirror.buy("agent", "MINT", 100);
  assert.equal(COPY_MAX_SLIPPAGE_BPS, 300);
  assert.deepEqual(seen, [300, 100]);
});

test("a copy buy is capped by the follower's max and the wallet, and skipped under 0.01 SOL", async () => {
  const spent: bigint[] = [];
  const exec = (have: bigint) => ({ buy: async (a: { lamports: bigint }) => (spent.push(a.lamports), fill(a.lamports, 5n)), sell: async () => fill(1n, 1n), spendable: async () => have });
  await createMirror(store(), exec(1_000_000_000n), silentLog, async () => true).buy("a", "M", 100);
  await createMirror(store(), exec(40_000_000n), silentLog, async () => true).buy("a", "M", 100);
  await createMirror(store(), exec(5_000_000n), silentLog, async () => true).buy("a", "M", 100);
  assert.deepEqual(spent, [100_000_000n, 40_000_000n]);
});

test("a follower without $MIMIR is paused and buys nothing; a failing follower never stops the others", async () => {
  const paused: string[] = [];
  const bought: string[] = [];
  const subs = [
    { id: "gone", follower: "G", walletId: "g", wallet: "GW", maxPerTradeLamports: 100_000_000n },
    { id: "broken", follower: "B", walletId: "b", wallet: "BW", maxPerTradeLamports: 100_000_000n },
    { id: "ok", follower: "O", walletId: "o", wallet: "OW", maxPerTradeLamports: 100_000_000n },
  ];
  const exec = {
    buy: async (a: { wallet: string }) => {
      if (a.wallet === "BW") throw new Error("rpc down");
      bought.push(a.wallet);
      return fill(1n, 1n);
    },
    sell: async () => fill(1n, 1n),
    spendable: async () => 1_000_000_000n,
  };
  await createMirror(store({ solSubs: async () => subs, pauseForGate: async (id) => void paused.push(id) }), exec, silentLog, async (f) => f !== "G").buy("a", "M", 100);
  assert.deepEqual(paused, ["gone"]);
  assert.deepEqual(bought, ["OW"]);
});

test("a sell mirrors the same fraction, all of it at 1, paused holders included", async () => {
  const sold: bigint[] = [];
  const settled: Array<[bigint, bigint]> = [];
  const s = store({
    holders: async () => [{ id: "s1", walletId: "cw", wallet: "CW", tokens: 1_000n }],
    settleSell: async (_id, _m, held, left) => void settled.push([held, left]),
  });
  const exec = { buy: async () => fill(1n, 1n), sell: async (a: { tokens: bigint }) => (sold.push(a.tokens), fill(1n, a.tokens)), spendable: async () => 0n };
  await createMirror(s, exec, silentLog, async () => false).sell("a", "M", 0.25, 100);
  await createMirror(s, exec, silentLog, async () => false).sell("a", "M", 1, 100);
  assert.deepEqual(sold, [250n, 1_000n]);
  assert.deepEqual(settled, [[1_000n, 750n], [1_000n, 0n]]);
});

test("arc copy amount: the cap within the balance minus gas, in cents, 0 under the pool minimum", () => {
  assert.equal(arcCopyAmount(5, 100, 0.1), 5);
  assert.equal(arcCopyAmount(5, 2.059, 0.1), 2);
  assert.equal(arcCopyAmount(5, 0.12, 0.1), 0);
});

test("arc copy: pools only, gated by $MIMIR, one follower's failure never stops another", async () => {
  const staked: string[] = [];
  const paused: string[] = [];
  const d: ArcCopyDeps = {
    subs: async () => [
      { id: "a", follower: "A", walletId: "wa", wallet: "A", maxPerStakeUsdc: 3 },
      { id: "b", follower: "B", walletId: "wb", wallet: "B", maxPerStakeUsdc: 3 },
      { id: "c", follower: "C", walletId: "wc", wallet: "C", maxPerStakeUsdc: 3 },
    ],
    pauseForGate: async (id) => void paused.push(id),
    balanceUsdc: async (w) => (w === "B" ? Promise.reject(new Error("rpc")) : 10),
    stake: async (a) => (staked.push(`${a.walletId}:${a.marketId}:${a.side}:${a.amountUsdc}`), "0xtx"),
    holds: async (f) => f !== "C",
    log: silentLog,
    minStakeUsdc: 0.1,
  };
  assert.equal(await mirrorArcStake(d, { kind: "vs", marketId: 7 }, 2), 0);
  assert.equal(await mirrorArcStake(d, { kind: "pool", marketId: 7 }, 2), 1);
  assert.deepEqual(staked, ["wa:7:2:3"]);
  assert.deepEqual(paused, ["c"]);
});
