import assert from "node:assert/strict";
import test from "node:test";

import { budgetDay, closesAt, fitsBudget, planTwin, sameMarket, twinPairKey, type TwinContext, type TwinSource } from "../../lib/chains/twins";
import { reconcileTwins, type TwinCandidate, type TwinDeps, type TwinRowPut } from "../../lib/chains/twin-reconciler";
import type { MarketChainId } from "../../lib/chains/registry";

const NOW = 1_800_000_000;
const USDC = 10n ** 18n;
const MIN = USDC / 10n; // 0.1 USDC, index units
const HOUSE = "0x00000000000000000000000000000000000000aa";
const USER = "0x00000000000000000000000000000000000000bb";

const source = (s: Partial<TwinSource> = {}): TwinSource => ({
  chain: "base", kind: "pool", marketId: 7, creator: USER, question: "Will it rain in Paris on Friday?", labelA: "Yes", labelB: "No",
  resolutionUrl: "https://weather.test/paris", category: "weather", deadline: NOW + 2 * 86_400, createdAt: NOW - 3_600, status: "open",
  isPrivate: false, creatorSide: 2, ...s,
});

const ctx = (c: Partial<TwinContext> = {}): TwinContext => ({
  now: NOW, target: "arc", targetMinStakeWei: MIN, houseWallet: HOUSE, houseAddresses: new Set([HOUSE]), houseStakeWei: MIN * 2n,
  budgetLeftWei: USDC, jevOn: false, triage: null, moderation: null, creatorTwinsToday: 0, perCreatorDay: 3, ...c,
});

test("user pool twin: minimum stake on the side the user staked, linked under a key named after the source", () => {
  const p = planTwin(source(), ctx());
  assert.deepEqual(p, { action: "open", side: 2, seedWei: MIN, pairKey: "twin:base:pool:7", house: false });
  // The source's own link is kept when it has one.
  assert.equal(twinPairKey(source({ pairKey: "agent:x:abc" })), "agent:x:abc");
  // Unknown opening side: side A.
  assert.equal((planTwin(source({ creatorSide: null }), ctx()) as { side: number }).side, 1);
});

test("house draft twin: seeded like the creator (its stake, side A), not moderated or capped", () => {
  const p = planTwin(source({ creator: HOUSE, creatorSide: 1, pairKey: "house:abc" }), ctx({ moderation: "block", triage: { spam: 1, resolvable: 0 }, creatorTwinsToday: 99 }));
  assert.deepEqual(p, { action: "open", side: 1, seedWei: MIN * 2n, pairKey: "house:abc", house: true });
});

test("twin skip rules: VS, private, not open, too close to the lock or an early lock, over a year, moderation, triage", () => {
  const skip = (s: Partial<TwinSource>, c: Partial<TwinContext> = {}) => {
    const p = planTwin(source(s), ctx(c));
    assert.equal(p.action, "skip", JSON.stringify(p));
    return (p as { reason: string }).reason;
  };
  assert.match(skip({ kind: "vs" }), /VS/);
  assert.match(skip({ isPrivate: true }), /private/);
  assert.match(skip({ status: "proposed" }), /proposed/);
  // Betting closes 60 s before the deadline: a deadline 20 minutes out leaves under the 30-minute lead.
  assert.match(skip({ deadline: NOW + 20 * 60 }), /too soon/);
  assert.match(skip({ lockAt: NOW + 10 * 60 }), /too soon/);
  assert.equal(closesAt({ deadline: NOW + 3600, lockAt: 0 }), NOW + 3540);
  assert.match(skip({ deadline: NOW + 400 * 86_400 }), /year/);
  assert.match(skip({}, { moderation: "block" }), /moderation/);
  assert.match(skip({}, { triage: { spam: 0.9, resolvable: 0.9 } }), /triage/);
  assert.match(skip({}, { triage: { spam: 0.1, resolvable: 0.1 } }), /triage/);
  assert.match(skip({ chain: "arc" }), /same chain/);
  // Enough lead time: opens.
  assert.equal(planTwin(source({ deadline: NOW + 40 * 60 }), ctx()).action, "open");
});

test("twin waits: no house wallet, triage pending (within the grace), creator cap, budget", () => {
  const wait = (s: Partial<TwinSource>, c: Partial<TwinContext>) => {
    const p = planTwin(source(s), ctx(c));
    assert.equal(p.action, "wait", JSON.stringify(p));
    return (p as { reason: string }).reason;
  };
  assert.match(wait({}, { houseWallet: null }), /wallet/);
  assert.match(wait({ createdAt: NOW - 60 }, { jevOn: true }), /triage/);
  // Past the grace, a missing triage no longer holds it back.
  assert.equal(planTwin(source({ createdAt: NOW - 3_600 }), ctx({ jevOn: true })).action, "open");
  assert.match(wait({}, { creatorTwinsToday: 3 }), /creator/);
  assert.match(wait({}, { budgetLeftWei: MIN - 1n }), /budget/);
});

test("one house budget for every chain", () => {
  const budget = USDC; // 1 USDC a day
  assert.equal(fitsBudget(budget, 0n, MIN), true);
  assert.equal(fitsBudget(budget, USDC - MIN, MIN), true);
  assert.equal(fitsBudget(budget, USDC - MIN + 1n, MIN), false);
  assert.equal(fitsBudget(budget, 0n, 0n), false);
  assert.equal(budgetDay(Date.UTC(2026, 10, 1, 23, 59)), "2026-11-01");
  assert.equal(sameMarket(source(), source({ question: "  will it rain in paris on friday? ", chain: "arc" })), true);
  assert.equal(sameMarket(source(), source({ deadline: NOW + 1 })), false);
});

// ── The reconciler pass, with fakes ────────────────────────────────────────────

function harness(opts: { candidates?: TwinCandidate[]; same?: number | null; create?: () => Promise<string>; budgetWei?: bigint; funded?: boolean; moderate?: "block" | null; pending?: Awaited<ReturnType<TwinDeps["pending"]>>; resolved?: number | null } = {}) {
  const puts: TwinRowPut[] = [];
  const links: Array<[string, number, number]> = [];
  const creates: Array<{ target: MarketChainId; side: number; seed: bigint }> = [];
  let spent = 0n;
  const holds = new Map<string, bigint>();
  const budget = opts.budgetWei ?? USDC;
  const deps: TwinDeps = {
    pending: async () => opts.pending ?? [],
    resolveTx: async () => opts.resolved ?? null,
    candidates: async () => opts.candidates ?? [],
    findSame: async () => opts.same ?? null,
    planContext: async (s, target) => ctx({ target, triage: s.triage, budgetLeftWei: budget - spent }),
    moderate: async () => opts.moderate ?? null,
    funded: async () => opts.funded ?? true,
    reserve: async (_t, wei) => {
      if (spent + wei > budget) return null;
      spent += wei;
      const id = `h${holds.size}`;
      holds.set(id, wei);
      return id;
    },
    release: async (id) => {
      spent -= holds.get(id) ?? 0n;
      holds.delete(id);
    },
    create: async (target, _s, side, seed) => {
      creates.push({ target, side, seed });
      return opts.create ? opts.create() : "0xtx";
    },
    createdId: async () => 42,
    link: async (pairKey, a, b) => void links.push([pairKey, a.marketId, b.marketId]),
    put: async (row) => void puts.push(row),
  };
  return { deps, puts, links, creates, spent: () => spent };
}
const cand = (s: Partial<TwinCandidate> = {}): TwinCandidate => ({ ...source(), missing: ["arc"], triage: null, twins: [], ...s });
const opts = { now: NOW * 1000, day: "2026-11-01", houseAddresses: new Set([HOUSE]) };

test("reconciler: opens the missing leg from the house, seeds it, reserves the budget and links both legs", async () => {
  const h = harness({ candidates: [cand()] });
  const r = await reconcileTwins(h.deps, opts);
  assert.equal(r.opened, 1);
  assert.deepEqual(h.creates, [{ target: "arc", side: 2, seed: MIN }]);
  assert.equal(h.spent(), MIN);
  assert.deepEqual(h.links, [["twin:base:pool:7", 7, 42]]);
  assert.deepEqual(h.puts.map((p) => p.status), ["sending", "sent", "linked"]);
  assert.ok(r.touched.has("arc"));
});

test("reconciler: adopts an identical pool already on the other chain instead of opening one", async () => {
  const h = harness({ candidates: [cand()], same: 5 });
  await reconcileTwins(h.deps, opts);
  assert.equal(h.creates.length, 0);
  assert.deepEqual(h.links, [["twin:base:pool:7", 7, 5]]);
  assert.equal(h.puts[0].status, "linked");
});

test("reconciler: a failed open releases the budget and is retried, then skipped as rejected", async () => {
  const fail = () => Promise.reject(new Error("execution reverted: DeadlineTooSoon"));
  const first = harness({ candidates: [cand()], create: fail });
  await reconcileTwins(first.deps, opts);
  assert.equal(first.spent(), 0n);
  assert.equal(first.puts.at(-1)!.status, "failed");
  // A row backing off is left alone until its time.
  const later = harness({ candidates: [cand({ twins: [{ chain: "arc", status: "failed", notBefore: NOW * 1000 + 1, attempts: 1 }] })], create: fail });
  await reconcileTwins(later.deps, opts);
  assert.equal(later.creates.length, 0);
  // The last attempt: skipped for good, with the contract's reason.
  const last = harness({ candidates: [cand({ twins: [{ chain: "arc", status: "failed", notBefore: 0, attempts: 2 }] })], create: fail });
  await reconcileTwins(last.deps, opts);
  assert.equal(last.puts.at(-1)!.status, "skipped");
  assert.match(last.puts.at(-1)!.reason!, /rejected: execution reverted/);
});

test("reconciler: budget used, unfunded wallet, moderation block, VS and done rows open nothing", async () => {
  const broke = harness({ candidates: [cand()], budgetWei: MIN - 1n });
  await reconcileTwins(broke.deps, opts);
  assert.equal(broke.creates.length, 0);
  assert.equal(broke.puts[0].status, "waiting");
  const unfunded = harness({ candidates: [cand()], funded: false });
  await reconcileTwins(unfunded.deps, opts);
  assert.equal(unfunded.creates.length, 0);
  assert.equal(unfunded.puts[0].reason, "house wallet unfunded");
  const blocked = harness({ candidates: [cand()], moderate: "block" });
  await reconcileTwins(blocked.deps, opts);
  assert.equal(blocked.puts[0].status, "skipped");
  const vs = harness({ candidates: [cand({ kind: "vs" })] });
  await reconcileTwins(vs.deps, opts);
  assert.equal(vs.creates.length, 0);
  assert.equal(vs.puts[0].status, "skipped");
  const done = harness({ candidates: [cand({ twins: [{ chain: "arc", status: "skipped", notBefore: 0, attempts: 0 }] })] });
  await reconcileTwins(done.deps, opts);
  assert.equal(done.puts.length, 0);
});

test("reconciler: a house draft that failed on one chain gets its leg under the house pairKey", async () => {
  const h = harness({ candidates: [cand({ creator: HOUSE, creatorSide: 1, pairKey: "house:abc" })] });
  await reconcileTwins(h.deps, opts);
  assert.deepEqual(h.creates, [{ target: "arc", side: 1, seed: MIN * 2n }]);
  assert.equal(h.links[0][0], "house:abc");
});

test("reconciler: a sent twin is linked once its market id is known; a lost send is marked failed", async () => {
  const key = { srcChain: "base" as const, srcMarketId: 7, chain: "arc" as const, pairKey: "twin:base:pool:7", creator: USER, house: false };
  const sent = harness({ pending: [{ ...key, status: "sent", tx: "0xtx", at: NOW * 1000 }], resolved: 9 });
  await reconcileTwins(sent.deps, opts);
  assert.deepEqual(sent.links, [["twin:base:pool:7", 7, 9]]);
  assert.equal(sent.puts[0].status, "linked");
  const lost = harness({ pending: [{ ...key, status: "sending", at: NOW * 1000 - 20 * 60_000 }] });
  await reconcileTwins(lost.deps, opts);
  assert.equal(lost.puts[0].status, "failed");
});

test("reconciler: at most perTick opens per pass", async () => {
  const h = harness({ candidates: [cand({ marketId: 1 }), cand({ marketId: 2 }), cand({ marketId: 3 })] });
  const r = await reconcileTwins(h.deps, { ...opts, perTick: 2 });
  assert.equal(r.opened, 2);
  assert.equal(h.creates.length, 2);
});
