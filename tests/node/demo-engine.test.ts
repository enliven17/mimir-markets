import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, initialDemoState, nativeEquity, demoReturn, type DemoAgent, type DemoStake } from "../../lib/demo/types";
import { tradeDemo, stakeDemo, settleDemoStake } from "../../lib/demo/engine";
import { DemoCreateBody, DemoBasketBody } from "../../lib/demo/input";
import { demoLiveDraft } from "../../lib/demo/promotion";
import { showcasePreviews } from "../../lib/demo/showcase";
import { showcaseSample } from "../../lib/demo/showcase-samples";
import { DEFAULT_MARKET_RULES, type MarketView } from "../../lib/launch/markets";
import { cand, config, risk, MINT_A, MINT_B, MINT_C } from "../../lib/launch/engine/fixtures";

const now = Date.UTC(2026, 9, 24, 12);
const agent = (over: Partial<DemoAgent> = {}): DemoAgent => ({
  id: "demo1", name: "Demo", ticker: "DEMO", avatarSeed: "demo", thesis: "Momentum", chain: "solana", status: "live",
  createdAt: now, expiresAt: now + DEMO.sessionMs, nextTickAt: now,
  trading: { enabled: true, config: config(), risk: risk() },
  markets: { enabled: true, rules: { ...DEFAULT_MARKET_RULES }, budgetUsdc: 20 },
  state: initialDemoState(now), ...over,
});
const scores = (mint = MINT_A) => new Map([[mint, { score: 0.9, why: "Fits the thesis" }]]);
const market = (over: Partial<MarketView> = {}): MarketView => ({ kind: "pool", marketId: 1, question: "Will the home team win?", labelA: "Yes", labelB: "No", category: "sports", deadline: Math.floor(now / 1000) + 3_600, lockAt: 0, usdcA: 100, usdcB: 100, status: "open", ...over });
const judged = () => new Map([[1, { pA: 0.8, why: "Home advantage" }]]);
const stake = (): DemoStake => ({ id: "s1", ...stakeDemo(agent(), initialDemoState(now), [market()], [], judged(), now)! });
const closeTo = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

test("paper entry uses live hard rules, sizing and thesis scores without mutating input", () => {
  const a = agent();
  const result = tradeDemo(a, [cand(MINT_A)], scores(), now);
  assert.equal(result.state.positions.length, 1);
  assert.equal(a.state.positions.length, 0);
  closeTo(result.state.cash, 9);
  closeTo(result.state.positions[0].entryPrice, 0.00103);
  closeTo(result.state.positions[0].quantity, 1 / 0.00103);
  assert.equal(result.state.trades[0].reason, "Fits the thesis");
});

test("high scores cannot bypass rules, missing prices or selected sources", () => {
  for (const c of [cand(MINT_A, { metrics: {} }), cand(MINT_A, { priceSol: null }), cand(MINT_A, { source: "helius" })]) {
    assert.equal(tradeDemo(agent(), [c], scores(), now).state.positions.length, 0);
  }
  assert.equal(tradeDemo(agent(), [cand(MINT_A)], scores(MINT_B), now).state.positions.length, 0);
  assert.equal(tradeDemo(agent(), [cand(MINT_A)], new Map(), now).state.positions.length, 0);
});

test("stop loss closes at an adverse simulated fill, updates cash and realized PnL", () => {
  const a = agent();
  a.state = tradeDemo(a, [cand(MINT_A)], scores(), now).state;
  const result = tradeDemo(a, [cand(MINT_A, { priceSol: 0.0007 })], new Map(), now + 60_000);
  assert.equal(result.state.positions.length, 0);
  const sale = result.state.trades[0];
  assert.equal(sale.side, "sell");
  assert.match(sale.reason, /SL/);
  closeTo(sale.amount, (1 / 0.00103) * 0.0007 * 0.97);
  closeTo(result.state.cash, 10 + sale.pnl);
  closeTo(result.state.dailyPnl, sale.pnl);
});

test("take profit and trailing stop use the same live exit engine", () => {
  const a = agent();
  a.state = tradeDemo(a, [cand(MINT_A)], scores(), now).state;
  const win = tradeDemo(a, [cand(MINT_A, { priceSol: 0.002 })], new Map(), now + 60_000);
  assert.match(win.state.trades[0].reason, /TP/);
  a.trading.config!.trailingStopPct = 10;
  a.trading.risk!.takeProfitPct = 300;
  a.state = tradeDemo(a, [cand(MINT_A, { priceSol: 0.0015 })], new Map(), now + 60_000).state;
  const trail = tradeDemo(a, [cand(MINT_A, { priceSol: 0.0013 })], new Map(), now + 120_000);
  assert.match(trail.state.trades[0].reason, /trailing/);
});

test("max hold and shutdown cannot fabricate a fill from a stale or absent price", () => {
  const a = agent();
  a.trading.config!.maxHoldMinutes = 1;
  a.state = tradeDemo(a, [cand(MINT_A)], scores(), now).state;
  for (const status of ["live", "killed"] as const) {
    const result = tradeDemo({ ...a, status }, [], scores(), now + 120_000);
    assert.equal(result.state.positions.length, 1);
    assert.equal(result.state.trades.length, 1);
  }
  const timed = tradeDemo(a, [cand(MINT_A)], new Map(), now + 120_000);
  assert.match(timed.state.trades[0].reason, /max hold/);
});

test("paused agents still exit but never enter; shutdown closes all freshly priced positions", () => {
  const a = agent();
  a.state = tradeDemo(a, [cand(MINT_A)], scores(), now).state;
  const paused = tradeDemo({ ...a, status: "paused" }, [cand(MINT_A, { priceSol: 0.0005 }), cand(MINT_B)], scores(MINT_B), now + 60_000);
  assert.equal(paused.state.positions.length, 0);
  const killed = tradeDemo({ ...a, status: "killed" }, [cand(MINT_A), cand(MINT_B)], scores(MINT_B), now + 60_000);
  assert.equal(killed.state.positions.length, 0);
  assert.equal(killed.state.trades[0].reason, "Agent shut down by its owner");
});

test("daily loss cap pauses without new entries, survives trimmed history and resets at UTC midnight", () => {
  const a = agent();
  a.state.dailyPnl = -2;
  a.state.trades = [];
  a.state.cash = 8;
  const capped = tradeDemo(a, [cand(MINT_A)], scores(), now);
  assert.equal(capped.pause, true);
  assert.equal(capped.state.positions.length, 0);
  const next = tradeDemo({ ...a, status: "live" }, [cand(MINT_A)], scores(), now + 86_400_000);
  assert.equal(next.pause, false);
  assert.equal(next.state.dailyPnl, 0);
  assert.equal(next.state.positions.length, 1);
});

test("three-position limit, insufficient balance and duplicate mints are enforced", () => {
  const a = agent();
  for (const mint of [MINT_A, MINT_B, MINT_C]) a.state = tradeDemo(a, [cand(mint)], scores(mint), now).state;
  assert.equal(a.state.positions.length, 3);
  const next = tradeDemo(a, [cand(MINT_A)], scores(), now);
  assert.equal(next.state.positions.length, 3);
  assert.equal(next.state.cash, a.state.cash);
  const empty = agent(); empty.state.cash = 0;
  assert.equal(tradeDemo(empty, [cand(MINT_A)], scores(), now).state.positions.length, 0);
});

test("virtual equity marks open positions and blends enabled sleeves without mixing currencies", () => {
  const a = agent();
  a.state = tradeDemo(a, [cand(MINT_A)], scores(), now).state;
  closeTo(nativeEquity(a.state), 9 + 1 / 1.03);
  a.state.usdc = 990;
  closeTo(demoReturn(a, 10), (nativeEquity(a.state) / 10 - 1) / 2);
  a.trading.enabled = false;
  closeTo(demoReturn(a, 10), 0);
});

test("paper market stakes respect category, closing time, edge, duplicate and open-budget rules", () => {
  const a = agent();
  const before = JSON.stringify(market());
  const s = stakeDemo(a, a.state, [market()], [], judged(), now)!;
  assert.ok(s.amount > 0 && s.amount <= a.markets.rules.maxStakeUsdc);
  closeTo(a.state.usdc, 1_000 - s.amount);
  assert.equal(JSON.stringify(market()), before);
  assert.equal(stakeDemo(a, a.state, [market()], [{ id: "s1", ...s }], judged(), now), null);
  assert.equal(stakeDemo(agent(), initialDemoState(now), [market({ status: "resolved" })], [], judged(), now), null);
  a.markets.rules.categories = ["crypto"];
  assert.equal(stakeDemo(a, a.state, [market()], [], judged(), now), null);
  a.markets.rules.categories = [];
  a.markets.budgetUsdc = 0;
  assert.equal(stakeDemo(a, a.state, [market()], [], judged(), now), null);
});

test("final settlement includes standard entry fees; proposed/disputed markets wait", () => {
  const s = stake();
  const m = { status: "resolved", winner: s.side, stakeA: String(100n * 10n ** 18n), stakeB: String(200n * 10n ** 18n) };
  const net = s.amount * 0.995;
  closeTo(settleDemoStake(s, m)!.payout, net + net * 200 / (100 + net));
  assert.deepEqual(settleDemoStake(s, { ...m, winner: 2 }), { status: "lost", payout: 0 });
  closeTo(settleDemoStake(s, { ...m, winner: 3 })!.payout, net);
  closeTo(settleDemoStake(s, { ...m, status: "cancelled" })!.payout, net);
  assert.equal(settleDemoStake(s, { ...m, status: "proposed" }), null);
  assert.equal(settleDemoStake(s, { ...m, status: "disputed" }), null);
  assert.equal(settleDemoStake({ ...s, status: "won" }, m), null);
});

test("demo input shares live risk validation, rejects unavailable sources and strips real funding fields", () => {
  const input = { name: "Test", ticker: "TEST", chain: "solana", trading: { enabled: true, strategy: { preset: "trending", sources: ["dexscreener"], entry: [{ metric: "liquidityUsd", op: ">", value: 1 }] }, risk: risk() }, markets: { enabled: true }, seedSol: 100, walletId: "real" };
  const parsed = DemoCreateBody.parse(input);
  assert.equal("seedSol" in parsed, false);
  assert.equal("walletId" in parsed, false);
  assert.equal(DemoCreateBody.safeParse({ ...input, chain: "arc" }).success, false);
  assert.equal(DemoCreateBody.safeParse({ ...input, trading: { ...input.trading, risk: { ...risk(), positionPct: 100 } } }).success, false);
  assert.equal(DemoCreateBody.safeParse({ ...input, trading: { ...input.trading, strategy: { ...input.trading.strategy, sources: ["x"] } } }).success, false);
  assert.equal(DemoCreateBody.safeParse({ ...input, markets: { enabled: true, create: { enabled: true, perDay: 1 } } }).success, false);
});

test("demo baskets require unique members and exactly 100% of integer basis points", () => {
  const body = { name: "Test", members: [{ agentId: "a", weightBps: 5_000 }, { agentId: "b", weightBps: 5_000 }] };
  assert.equal(DemoBasketBody.safeParse(body).success, true);
  assert.equal(DemoBasketBody.safeParse({ ...body, members: [...body.members, body.members[0]] }).success, false);
  assert.equal(DemoBasketBody.safeParse({ ...body, members: [{ agentId: "a", weightBps: 9_999 }] }).success, false);
});

test("live conversion carries identity, thesis and every strategy rule while excluding virtual funds and history", () => {
  const a = agent();
  a.trading.config!.trailingStopPct = 12;
  a.trading.config!.maxHoldMinutes = 45;
  a.state.cash = 999;
  const draft = demoLiveDraft(a);
  assert.equal(draft.name, a.name); assert.equal(draft.chain, a.chain); assert.equal(draft.avatarSeed, a.avatarSeed);
  assert.equal(draft.thesis, a.thesis); assert.equal(draft.trading.enabled, true);
  if (!draft.trading.enabled) assert.fail("expected trading");
  assert.deepEqual(draft.trading.risk, a.trading.risk);
  assert.deepEqual(draft.trading.strategy.entry, a.trading.config!.entry);
  assert.equal(draft.trading.trailingStopPct, 12); assert.equal(draft.trading.maxHoldMinutes, 45);
  assert.equal(draft.markets.maxHoursToClose, a.markets.rules.maxHoursToClose);
  for (const key of ["state", "cash", "seedSol", "wallet", "pnl", "trades", "session"]) assert.equal(key in draft, false);
  draft.trading.strategy.entry[0].value = 42;
  assert.notEqual(a.trading.config!.entry[0].value, 42);
});

test("positive showcase examples stay separate from current paper balances and recorded returns", () => {
  const previews = showcasePreviews();
  assert.equal(previews.length, 5);
  for (const a of previews) {
    const sample = showcaseSample(a.showcaseKey!)!;
    assert.ok(sample.totalReturn > 0);
    assert.ok(sample.drawdown > 0);
    assert.equal(sample.curve[0], 1_000);
    assert.equal(a.state.cash, DEMO.initialNative);
    assert.equal(a.state.usdc, DEMO.initialUsdc);
    assert.equal(a.state.trades.length, 0);
    assert.equal(a.state.pnl, 0);
    assert.equal(demoReturn(a), 0);
  }
});
