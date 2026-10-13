import { test } from "node:test";
import assert from "node:assert/strict";
import type { PositionRow } from "../../lib/launch/ports";
import { cand, config, MINT_A, MINT_B, risk } from "../../lib/launch/engine/fixtures";
import { entryPriceFor, tickAgent } from "../../lib/launch/worker/tick";
import { manageExits, tokensFor } from "../../lib/launch/worker/tick-exits";
import { createContext } from "../../lib/launch/worker/tick-context";
import { agentRow, deps, fakeExecutor, fakeRepo, fixedRanker, SOL, staticPrices, staticSource } from "./launch-worker-fakes";

const NOW = 1_791_217_500_000;
const position = (over: Partial<PositionRow> = {}): PositionRow => ({
  id: "1", agentId: "pnut", mint: MINT_A, symbol: "PNUT", tokens: 1_000_000n, decimals: 6,
  costLamports: SOL, entryPrice: 1, highPrice: 1, openedAt: new Date(NOW - 60_000), ...over,
});

test("buy path: rules → rank → size → buy → position + events", async () => {
  const agent = agentRow();
  const { repo, state } = fakeRepo(agent);
  const { executor, calls } = fakeExecutor();
  const ranker = fixedRanker({ [MINT_A]: 0.8, [MINT_B]: 0.95 });
  const sources = { dexscreener: staticSource("dexscreener", [cand(MINT_A, { symbol: "AAA" }), cand(MINT_B, { symbol: "BBB", metrics: { liquidityUsd: 10 } })]) };
  const r = await tickAgent(agent, deps({ repo, executor, ranker, sources }));
  assert.equal(r.bought, MINT_A); // B scored higher but failed the liquidity rule
  assert.deepEqual(calls, [{ op: "buy", mint: MINT_A, amount: SOL }]);
  assert.equal(state.positions.length, 1);
  assert.equal(state.positions[0].entryPrice, 1 / 1000); // from the fill, SOL per whole token
  assert.deepEqual(state.events.map((e) => e.kind), ["scan", "score", "rules", "buy"]);
  assert.match(state.events.at(-1)?.text ?? "", /^bought \$AAA for 1 SOL \(score 0\.80: fits thesis\)$/);
});

test("SL path: sells 100%, closes the position, human-readable event", async () => {
  const agent = agentRow({ config: config({ sources: [] }) });
  const { repo, state } = fakeRepo(agent, [position()]);
  const { executor, calls } = fakeExecutor({ sellLamports: 830_000_000n });
  const r = await tickAgent(agent, deps({ repo, executor, prices: staticPrices({ [MINT_A]: 0.84 }) }));
  assert.equal(r.sold, 1);
  assert.deepEqual(calls, [{ op: "sell", mint: MINT_A, amount: 1_000_000n }]);
  assert.equal(state.positions.length, 0);
  assert.equal(state.events[0].kind, "sell");
  assert.match(state.events[0].text, /^SL -15% hit \(-16%\) on \$PNUT, sold 100% for 0\.83 SOL \(-0\.17 SOL\)$/);
});

test("hold updates the high; no sell", async () => {
  const agent = agentRow({ config: config({ sources: [] }) });
  const { repo, state } = fakeRepo(agent, [position()]);
  const { executor, calls } = fakeExecutor();
  await tickAgent(agent, deps({ repo, executor, prices: staticPrices({ [MINT_A]: 1.2 }) }));
  assert.equal(calls.length, 0);
  assert.equal(state.positions[0].highPrice, 1.2);
});

test("partial exit reduces the position", async () => {
  const agent = agentRow();
  const { repo, state } = fakeRepo(agent, [position()]);
  const { executor } = fakeExecutor({ sellLamports: 600_000_000n });
  const ctx = createContext(agent, deps({ repo, executor, prices: staticPrices({ [MINT_A]: 1.5 }) }));
  const half = () => ({ action: "sell" as const, fraction: 0.5, reason: "TP scale-out", kind: "take_profit" as const, high: 1.5, pnlPct: 50 });
  const out = await manageExits(agent, await repo.openPositions(agent.id), ctx, half);
  assert.equal(out.sold, 1);
  assert.deepEqual([state.positions[0].tokens, state.positions[0].costLamports], [500_000n, SOL / 2n]);
  assert.equal(out.remaining[0].tokens, 500_000n);
  assert.match(state.events[0].text, /sold 50% for 0\.6 SOL \(\+0\.1 SOL\)/);
  assert.equal(tokensFor(position(), 0), 0n);
  assert.equal(tokensFor(position(), 2), 1_000_000n);
});

test("partial fill: the position is accounted with the tokens the chain actually sold, not the request", async () => {
  const agent = agentRow();
  const { repo, state } = fakeRepo(agent, [position()]);
  // Asked to sell 500_000 (50%); the confirmed tx shows only 300_000 left the wallet, for 0.36 SOL.
  const { executor } = fakeExecutor({ sellLamports: 360_000_000n, sellTokens: 300_000n });
  const ctx = createContext(agent, deps({ repo, executor, prices: staticPrices({ [MINT_A]: 1.5 }) }));
  const half = () => ({ action: "sell" as const, fraction: 0.5, reason: "TP scale-out", kind: "take_profit" as const, high: 1.5, pnlPct: 50 });
  const out = await manageExits(agent, await repo.openPositions(agent.id), ctx, half);
  assert.deepEqual([state.positions[0].tokens, state.positions[0].costLamports], [700_000n, 700_000_000n]);
  assert.deepEqual([out.remaining[0].tokens, out.remaining[0].costLamports], [700_000n, 700_000_000n]);
  assert.equal(state.trades.at(-1)?.tokens, 300_000n);
  assert.match(state.events[0].text, /sold 30% for 0\.36 SOL \(\+0\.06 SOL\)/);
});

test("partial fill: a fractional exit whose fill took the whole position closes it", async () => {
  const agent = agentRow();
  const { repo, state } = fakeRepo(agent, [position()]);
  const { executor } = fakeExecutor({ sellLamports: 1_200_000_000n, sellTokens: 1_000_000n });
  const ctx = createContext(agent, deps({ repo, executor, prices: staticPrices({ [MINT_A]: 1.5 }) }));
  const half = () => ({ action: "sell" as const, fraction: 0.5, reason: "TP scale-out", kind: "take_profit" as const, high: 1.5, pnlPct: 50 });
  const out = await manageExits(agent, await repo.openPositions(agent.id), ctx, half);
  assert.equal(state.positions.length, 0);
  assert.equal(out.remaining.length, 0);
  assert.equal(state.trades.at(-1)?.pnl, 200_000_000n);
});

test("error isolation: failing source, failing buy → error event without secrets, no throw", async () => {
  const agent = agentRow({ config: config({ sources: ["dexscreener", "pumpfun"] }) });
  const { repo, state } = fakeRepo(agent);
  const { executor } = fakeExecutor({ failBuy: true });
  const sources = { dexscreener: staticSource("dexscreener", [cand(MINT_A)]), pumpfun: staticSource("pumpfun", () => { throw new Error("ws down"); }) };
  const r = await tickAgent(agent, deps({ repo, executor, sources, ranker: fixedRanker({ [MINT_A]: 0.9 }) }));
  assert.equal(r.errors, 1);
  const err = state.events.find((e) => e.kind === "error");
  assert.match(err?.text ?? "", /^buy failed: blockhash expired <url>/);
  assert.doesNotMatch(err?.text ?? "", /SECRET/);
});

test("a failing sell on one position does not block the next", async () => {
  const agent = agentRow({ config: config({ sources: [] }) });
  const { repo, state } = fakeRepo(agent, [position(), position({ id: "2", mint: MINT_B, symbol: "BBB" })]);
  const { executor } = fakeExecutor();
  let n = 0;
  const flaky = { ...executor, sell: async (a: Parameters<typeof executor.sell>[0]) => (n++ === 0 ? Promise.reject(new Error("reverted")) : executor.sell(a)) };
  const r = await tickAgent(agent, deps({ repo, executor: flaky, prices: staticPrices({ [MINT_A]: 0.5, [MINT_B]: 0.5 }) }));
  assert.deepEqual([r.sold, r.errors], [1, 1]);
  assert.deepEqual(state.positions.map((p) => p.id), ["1"]);
});

test("daily cap hit → paused + event, no buy", async () => {
  const agent = agentRow();
  const { repo, state } = fakeRepo(agent);
  state.dailyPnl = -2n * SOL; // bankroll = 8 + 2 = 10 SOL, cap 20% = 2 SOL → exactly hit
  const { executor, calls } = fakeExecutor({ spendable: 8n * SOL });
  const r = await tickAgent(agent, deps({ repo, executor, sources: { dexscreener: staticSource("dexscreener", [cand(MINT_A)]) }, ranker: fixedRanker({ [MINT_A]: 1 }) }));
  assert.equal(r.paused, true);
  assert.equal(state.agent.status, "paused");
  assert.equal(calls.length, 0);
  assert.match(state.events[0].text, /daily loss cap hit \(-2 SOL today, cap -2 SOL\), agent paused/);
});

test("no double entry in a held mint; max open respected", async () => {
  const agent = agentRow();
  const { repo } = fakeRepo(agent, [position()]);
  const { executor, calls } = fakeExecutor();
  const sources = { dexscreener: staticSource("dexscreener", [cand(MINT_A)]) };
  const r = await tickAgent(agent, deps({ repo, executor, sources, prices: staticPrices({ [MINT_A]: 1 }), ranker: fixedRanker({ [MINT_A]: 1 }) }));
  assert.equal(r.bought, null);
  assert.equal(calls.length, 0);
  const full = fakeRepo(agent, [position(), position({ id: "2", mint: MINT_B }), position({ id: "3", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" })]);
  const r2 = await tickAgent(agent, deps({ repo: full.repo, executor, sources, prices: staticPrices({}) }));
  assert.equal(r2.skipped, "max open positions");
});

test("non-live agent (paused since listing) is skipped", async () => {
  const agent = agentRow();
  const { repo, state } = fakeRepo(agent);
  state.agent = { ...state.agent, status: "paused" };
  const { executor, calls } = fakeExecutor();
  const r = await tickAgent(agent, deps({ repo, executor }));
  assert.equal(r.skipped, "status paused");
  assert.equal(calls.length, 0);
});

test("buy lands but DB write fails 3x → RECONCILE event with sig, agent paused", async () => {
  const agent = agentRow({ risk: risk() });
  const { repo, state } = fakeRepo(agent);
  state.failWrites = 3;
  const { executor } = fakeExecutor();
  const r = await tickAgent(agent, deps({ repo, executor, sources: { dexscreener: staticSource("dexscreener", [cand(MINT_A)]) }, ranker: fixedRanker({ [MINT_A]: 0.9 }) }));
  assert.equal(r.paused, true);
  assert.equal(state.agent.status, "paused");
  const errs = state.events.filter((e) => e.kind === "error");
  assert.equal(errs.length, 1);
  assert.match(errs[0].text, /RECONCILE: buy \$TEST landed on-chain \(sig buy1\)/);
});

test("ranker failure (empty map) → no trade; own token never bought", async () => {
  const agent = agentRow({ mint: MINT_A });
  const { repo } = fakeRepo(agent);
  const { executor, calls } = fakeExecutor();
  await tickAgent(agent, deps({ repo, executor, sources: { dexscreener: staticSource("dexscreener", [cand(MINT_A), cand(MINT_B)]) }, ranker: fixedRanker({ [MINT_A]: 1 }) }));
  assert.equal(calls.length, 0);
});

test("entryPriceFor trusts the fill unless it is off-scale vs the quote", () => {
  const seen: number[] = [];
  assert.equal(entryPriceFor(0.0011, 0.001, (f) => seen.push(f)), 0.0011);
  assert.equal(entryPriceFor(0.000001, 0.001, (f) => seen.push(f)), 0.001);
  assert.equal(entryPriceFor(null, 0.001, (f) => seen.push(f)), 0.001);
  assert.deepEqual(seen, [0.000001]);
});

test("paused agent: exit rules still run (stop-loss fires), no new entries", async () => {
  const agent = agentRow({ status: "paused" });
  const { repo, state } = fakeRepo(agent, [position()]);
  const { executor, calls } = fakeExecutor();
  const sources = { dexscreener: staticSource("dexscreener", [cand(MINT_B, { symbol: "BBB" })]) };
  const r = await tickAgent(agent, deps({ repo, executor, sources, ranker: fixedRanker({ [MINT_B]: 0.99 }), prices: staticPrices({ [MINT_A]: 0.5 }) }));
  assert.equal(r.sold, 1);
  assert.deepEqual(calls.map((c) => c.op), ["sell"]);
  assert.equal(state.positions.length, 0);
});

test("killed agent: sells every position regardless of price, then returns SOL to the owner once", async () => {
  const agent = agentRow({ status: "killed" });
  const { repo, state } = fakeRepo(agent, [position(), position({ id: "2", mint: MINT_B, symbol: "BBB" })]);
  const { executor, calls } = fakeExecutor({ spendable: 3n * SOL });
  await tickAgent(agent, deps({ repo, executor, prices: staticPrices({}) }));
  assert.deepEqual(calls.map((c) => c.op), ["sell", "sell", "transfer"]);
  assert.equal(calls[2].mint, agent.owner);
  assert.equal(calls[2].amount, 3n * SOL);
  assert.equal(state.swept, true);
  assert.match(state.events.at(-1)?.text ?? "", /returned 3 SOL to the owner/);
});

test("killed agent with an unsellable position still returns its SOL, but keeps ticking", async () => {
  const agent = agentRow({ status: "killed" });
  const { repo, state } = fakeRepo(agent, [position()]);
  const { executor, calls } = fakeExecutor({ failSell: true, spendable: 2n * SOL });
  await tickAgent(agent, deps({ repo, executor, prices: staticPrices({}) }));
  assert.deepEqual(calls.filter((c) => c.op === "transfer").map((c) => c.amount), [2n * SOL]);
  assert.notEqual(state.swept, true, "not swept while a position is open");
});

// ---------------- the own-token lock ----------------

test("kill: the agent's own tokens are burned (recorded) before the SOL goes back; nothing is sold", async () => {
  const agent = agentRow({ status: "killed" });
  const { repo, state } = fakeRepo(agent);
  const { executor, calls } = fakeExecutor({ spendable: 3n * SOL, ownTokens: 123_456n });
  await tickAgent(agent, deps({ repo, executor }));
  assert.deepEqual(calls.map((c) => [c.op, c.mint, c.amount]), [["burn", agent.mint, 123_456n], ["transfer", agent.owner, 3n * SOL]]);
  assert.ok(state.events.some((e) => e.kind === "burn" && /burned the agent's remaining \$PNUT/.test(e.text)));
  assert.equal(state.swept, true);
});

test("H2: a pump.fun coin someone launched naming the agent wallet as creator is never a candidate", async () => {
  const agent = agentRow({ config: config({ sources: ["pumpfun"] }) });
  const { repo } = fakeRepo(agent);
  const { executor, calls } = fakeExecutor();
  const sources = { pumpfun: staticSource("pumpfun", [cand(MINT_A, { symbol: "BAIT", creator: agent.wallet }), cand(MINT_B, { symbol: "OK", creator: "Someone1111111111111111111111111111111111111" })]) };
  const r = await tickAgent(agent, deps({ repo, executor, ranker: fixedRanker({ [MINT_A]: 0.99, [MINT_B]: 0.8 }), sources }));
  assert.equal(r.bought, MINT_B);
  assert.ok(!calls.some((c) => c.mint === MINT_A));
});

test("H2: buys and sells carry the agent's own mint from the agent record", async () => {
  const agent = agentRow();
  const { repo } = fakeRepo(agent, [position()]);
  const { executor, args } = fakeExecutor();
  await tickAgent(agent, deps({ repo, executor, prices: staticPrices({ [MINT_A]: 0.5 }) }));
  assert.equal(args[0].op, "sell");
  assert.equal(args[0].ownMint, agent.mint);
});

test("M5: exits and entries tell the executor which open positions to protect", async () => {
  const agent = agentRow();
  const { repo } = fakeRepo(agent, [position(), position({ id: "2", mint: MINT_B })]);
  const { executor, args } = fakeExecutor();
  await tickAgent(agent, deps({ repo, executor, prices: staticPrices({ [MINT_A]: 0.5, [MINT_B]: 1 }) }));
  assert.equal(args[0].op, "sell");
  assert.deepEqual(args[0].protect, [MINT_A, MINT_B]);
});

// ---------------- idle / sleep when the agent cannot trade ----------------

const POOR = SOL / 20n; // 10% of 0.05 SOL = 0.005 SOL, below the 0.01 SOL minimum
const countingSource = () => {
  const src = { calls: 0, id: "dexscreener" as const, candidates: async () => (src.calls++, [cand(MINT_A, { symbol: "AAA" })]) };
  return src;
};

test("idle: a flat agent without enough SOL never scans or ranks; 3 such ticks put it to sleep with one event", async () => {
  const agent = agentRow();
  const { repo, state } = fakeRepo(agent);
  const { executor, calls, reads } = fakeExecutor({ spendable: POOR });
  const src = countingSource();
  const ranker = fixedRanker({ [MINT_A]: 0.99 });
  let clock = NOW;
  const d = deps({ repo, executor, ranker, sources: { dexscreener: src }, now: () => clock });
  const skipped: (string | undefined)[] = [];
  for (let i = 0; i < 3; i++) {
    skipped.push((await tickAgent(state.agent, d)).skipped);
    clock += 15_000;
  }
  assert.deepEqual(skipped, ["idle", "idle", "sleeping"]);
  assert.deepEqual([src.calls, ranker.calls, calls.length], [0, 0, 0]);
  assert.equal(state.agent.idle?.sleepingSince, NOW + 30_000);
  assert.deepEqual(state.events, [{ kind: "rules", text: "sleeping: not enough SOL to trade (needs 0.1 SOL, has 0.05 SOL). Send SOL to its wallet." }]);

  // Asleep: the 15 s tick costs nothing, not even a balance read, and logs nothing.
  const before = reads.spendable;
  for (let i = 0; i < 20; i++) {
    assert.equal((await tickAgent(state.agent, d)).skipped, "sleeping");
    clock += 15_000;
  }
  assert.equal(reads.spendable, before);
  assert.deepEqual([src.calls, ranker.calls, state.events.length], [0, 0, 1]);
});

test("idle: the counter resets once the agent can trade again before it fell asleep", async () => {
  const agent = agentRow({ idle: { ticks: 2 } });
  const { repo, state } = fakeRepo(agent);
  const { executor } = fakeExecutor();
  const r = await tickAgent(agent, deps({ repo, executor, ranker: fixedRanker({ [MINT_A]: 0.9 }), sources: { dexscreener: staticSource("dexscreener", [cand(MINT_A)]) } }));
  assert.equal(r.bought, MINT_A);
  assert.equal(state.agent.idle, undefined);
  assert.ok(!state.events.some((e) => /awake|sleeping/.test(e.text)));
});

test("idle: with an open position and no SOL the agent still runs its exits and is not counted idle", async () => {
  const agent = agentRow();
  const { repo, state } = fakeRepo(agent, [position()]);
  const { executor, calls } = fakeExecutor({ spendable: 0n });
  const r = await tickAgent(agent, deps({ repo, executor, prices: staticPrices({ [MINT_A]: 0.5 }) }));
  assert.equal(r.sold, 1);
  assert.deepEqual(calls.map((c) => c.op), ["sell"]);
  assert.equal(state.agent.idle, undefined);
});

test("sleep: the 10 minute re-check wakes a funded agent, which trades on that same tick", async () => {
  const asleep = { ticks: 3, sleepingSince: NOW, checkedAt: NOW };
  const agent = agentRow({ idle: asleep });
  const { repo, state } = fakeRepo(agent);
  const { executor, calls, reads } = fakeExecutor({ spendable: SOL });
  const src = countingSource();
  let clock = NOW + 9 * 60_000;
  const d = deps({ repo, executor, ranker: fixedRanker({ [MINT_A]: 0.9 }), sources: { dexscreener: src }, now: () => clock });
  assert.equal((await tickAgent(state.agent, d)).skipped, "sleeping");
  assert.equal(reads.spendable, 0);
  clock = NOW + 10 * 60_000;
  const r = await tickAgent(state.agent, d);
  assert.equal(r.bought, MINT_A);
  assert.deepEqual(calls.map((c) => c.op), ["buy"]);
  assert.equal(state.agent.idle, undefined);
  assert.match(state.events[0].text, /^awake: 1 SOL to trade with/);
});

test("sleep: a re-check that finds it still poor keeps it asleep silently for another 10 minutes", async () => {
  const agent = agentRow({ idle: { ticks: 3, sleepingSince: NOW, checkedAt: NOW } });
  const { repo, state } = fakeRepo(agent);
  const { executor, reads } = fakeExecutor({ spendable: POOR });
  let clock = NOW + 10 * 60_000;
  const d = deps({ repo, executor, now: () => clock });
  assert.equal((await tickAgent(state.agent, d)).skipped, "sleeping");
  assert.deepEqual([reads.spendable, state.events.length], [1, 0]);
  assert.deepEqual(state.agent.idle, { ticks: 3, sleepingSince: NOW, checkedAt: NOW + 10 * 60_000 });
  clock += 60_000;
  await tickAgent(state.agent, d);
  assert.equal(reads.spendable, 1);
});

test("sleep: a wake request gets an immediate check, which wakes it when the claim funded it", async () => {
  // A resume sets wakeRequestedAt on a sleeping agent.
  const agent = agentRow({ idle: { ticks: 3, sleepingSince: NOW, checkedAt: NOW, wakeRequestedAt: NOW + 60_000 } });
  const { repo, state } = fakeRepo(agent);
  const { executor } = fakeExecutor({ spendable: SOL });
  const r = await tickAgent(state.agent, deps({ repo, executor, now: () => NOW + 75_000, ranker: fixedRanker({ [MINT_A]: 0.9 }), sources: { dexscreener: staticSource("dexscreener", [cand(MINT_A)]) } }));
  assert.equal(r.bought, MINT_A);
  assert.equal(state.agent.idle, undefined);
});

test("sleep: a killed sleeping agent still sweeps its SOL back to the owner", async () => {
  const agent = agentRow({ status: "killed", idle: { ticks: 3, sleepingSince: NOW, checkedAt: NOW } });
  const { repo, state } = fakeRepo(agent);
  const { executor, calls } = fakeExecutor({ spendable: 2n * SOL });
  await tickAgent(agent, deps({ repo, executor }));
  assert.deepEqual(calls.map((c) => c.op), ["transfer"]);
  assert.equal(state.swept, true);
});
