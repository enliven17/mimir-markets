import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";

import {
  validateBasket,
  simulateVirtualBasket,
  followMessage,
  worstCaseFollowerExposure,
  InvalidBasketError,
  DEFAULT_BASKET_POLICY,
  VIRTUAL_BASKET_INITIAL_NAV,
  WEIGHT_TOTAL_BPS,
  ONE_USDC,
  challengerPnlUnits,
  settlementsFromClaims,
  mirrorSignals,
  composeMessage,
  isFreshSignature,
  isValidFollowCap,
  sanitizeMembers,
  type BasketMember,
  type IndexedClaim,
  type MemberSettlement,
} from "../../lib/baskets";
import { signAgentMessage, verifyAgentSignature } from "../../lib/agents/signature";

const members: BasketMember[] = [
  { agentId: "alpha", weightBps: 5_000 },
  { agentId: "beta", weightBps: 5_000 },
];

const ok = { name: "Contrarian mix", thesis: "Fade crowded consensus.", members };

function reasonOf(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof InvalidBasketError);
    return (err as InvalidBasketError).reason;
  }
  return "no_error";
}

test("a well-formed basket validates", () => {
  assert.doesNotThrow(() => validateBasket(ok));
});

test("weights must total exactly 10000 bps", () => {
  // Both legs stay under the concentration cap, so the total is what fails.
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 5_000 },
      { agentId: "beta", weightBps: 4_999 },
    ] })),
    "weights_must_total_10000_bps",
  );
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 4_000 },
      { agentId: "beta", weightBps: 4_000 },
    ] })),
    "weights_must_total_10000_bps",
  );
});

test("an agent cannot appear twice", () => {
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 5_000 },
      { agentId: "alpha", weightBps: 5_000 },
    ] })),
    "duplicate_agent",
  );
});

test("weights must be positive integers", () => {
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 5_000 },
      { agentId: "beta", weightBps: 0 },
    ] })),
    "non_positive_weight",
  );
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 4_000.5 },
      { agentId: "beta", weightBps: 4_999.5 },
    ] })),
    "weight_not_integer",
  );
});

test("no single agent may exceed the concentration cap", () => {
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 6_000 },
      { agentId: "beta", weightBps: 4_000 },
    ] })),
    "single_agent_over_cap",
  );
  // Exactly at the cap is allowed.
  assert.doesNotThrow(() => validateBasket(ok));
  assert.equal(members[0].weightBps, DEFAULT_BASKET_POLICY.maxSingleAgentBps);
});

test("a basket cannot be one agent, or a crowd", () => {
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [{ agentId: "alpha", weightBps: 10_000 }] })),
    "too_few_members",
  );
  const many = Array.from({ length: 13 }, (_, i) => ({ agentId: `a${i}`, weightBps: 769 }));
  assert.equal(reasonOf(() => validateBasket({ ...ok, members: many })), "too_many_members");
});

test("name and thesis are required", () => {
  assert.equal(reasonOf(() => validateBasket({ ...ok, name: "   " })), "missing_name");
  assert.equal(reasonOf(() => validateBasket({ ...ok, thesis: "" })), "missing_thesis");
});

test("an empty history leaves the NAV untouched", () => {
  const perf = simulateVirtualBasket(members, []);
  assert.equal(perf.points.length, 0);
  assert.equal(perf.finalNavAtomic, VIRTUAL_BASKET_INITIAL_NAV);
  assert.equal(perf.totalReturn, 0);
  assert.deepEqual(perf.idleAgents.sort(), ["alpha", "beta"]);
});

test("returns are stake-weighted, not vote-weighted", () => {
  // alpha wins 1 on a 10 stake (+10%), beta loses 1 on a 1 stake (-100%).
  // Equal weights: 0.5 * 0.10 + 0.5 * -1.00 = -45%.
  const settlements: MemberSettlement[] = [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: 10n * ONE_USDC, pnlAtomic: ONE_USDC },
    { agentId: "beta", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: -ONE_USDC },
  ];
  const perf = simulateVirtualBasket(members, settlements);
  assert.equal(perf.points.length, 1);
  assert.ok(Math.abs(perf.points[0].dailyReturn + 0.45) < 1e-9);
  assert.equal(perf.finalNavAtomic, 550n * ONE_USDC);
});

test("a member's several settlements in a day aggregate before weighting", () => {
  const settlements: MemberSettlement[] = [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: 5n * ONE_USDC, pnlAtomic: ONE_USDC },
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: 5n * ONE_USDC, pnlAtomic: -ONE_USDC },
  ];
  const perf = simulateVirtualBasket(members, settlements);
  // alpha nets 0 over a 10 stake; beta idle. The day is flat, not +10% then -10%.
  assert.equal(perf.points[0].dailyReturn, 0);
  assert.equal(perf.finalNavAtomic, VIRTUAL_BASKET_INITIAL_NAV);
});

test("an idle leg earns zero rather than the basket average", () => {
  // alpha doubles its money, beta does nothing: half the weight at 0%.
  const perf = simulateVirtualBasket(members, [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: ONE_USDC },
  ]);
  assert.ok(Math.abs(perf.points[0].dailyReturn - 0.5) < 1e-9);
  assert.deepEqual(perf.idleAgents, ["beta"]);
});

test("a day nobody settled produces no point at all", () => {
  const perf = simulateVirtualBasket(members, [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: ONE_USDC / 10n },
    { agentId: "alpha", day: "2026-09-03", stakeAtomic: ONE_USDC, pnlAtomic: ONE_USDC / 10n },
  ]);
  assert.deepEqual(perf.points.map((p) => p.day), ["2026-09-01", "2026-09-03"]);
});

test("settlements from agents outside the basket are ignored", () => {
  const perf = simulateVirtualBasket(members, [
    { agentId: "stranger", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: 100n * ONE_USDC },
  ]);
  assert.equal(perf.points.length, 0);
  assert.equal(perf.finalNavAtomic, VIRTUAL_BASKET_INITIAL_NAV);
});

test("drawdown is measured against the running high, not the start", () => {
  const perf = simulateVirtualBasket(members, [
    // Day 1: +20% basket (alpha +40% on its half).
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: 10n * ONE_USDC, pnlAtomic: 4n * ONE_USDC },
    // Day 2: -10% basket.
    { agentId: "alpha", day: "2026-09-02", stakeAtomic: 10n * ONE_USDC, pnlAtomic: -2n * ONE_USDC },
  ]);
  assert.ok(Math.abs(perf.points[0].dailyReturn - 0.2) < 1e-9);
  assert.equal(perf.points[0].drawdown, 0, "a new high has no drawdown");
  assert.ok(Math.abs(perf.points[1].drawdown + 0.1) < 1e-9, "down 10% from the high, not up 8% from the start");
  assert.ok(perf.totalReturn > 0, "still ahead of where it started");
  assert.ok(perf.maxDrawdown < 0);
});

test("the NAV cannot go negative", () => {
  const perf = simulateVirtualBasket(members, [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: -ONE_USDC },
    { agentId: "beta", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: -ONE_USDC },
  ]);
  assert.equal(perf.finalNavAtomic, 0n);
  assert.ok(perf.finalNavAtomic >= 0n);
});

test("the follow message names the basket, the follower and the cap, in exact base58 case", () => {
  const follower = Keypair.generate().publicKey.toBase58();
  const message = followMessage({
    basketId: "contrarian-mix",
    follower,
    perMarketCapUsdc: 5,
    signedAt: 1_800_000_000_000,
  });
  assert.match(message, /signedAt: 1800000000000/);
  assert.match(message, /basket: contrarian-mix/);
  assert.ok(message.includes(`follower: ${follower}`), "base58 is case-sensitive and never lowercased");
  assert.match(message, /perMarketCapUsdc: 5/);
  assert.match(message, /Nothing is deposited/);
});

test("a follow signature is ed25519 over the message and binds the cap", () => {
  const kp = Keypair.generate();
  const follower = kp.publicKey.toBase58();
  const args = { basketId: "contrarian-mix", follower, perMarketCapUsdc: 5, signedAt: 1_800_000_000_000 };
  const signature = signAgentMessage(followMessage(args), kp.secretKey);
  assert.ok(verifyAgentSignature({ address: follower, message: followMessage(args), signature }));
  assert.equal(
    verifyAgentSignature({ address: follower, message: followMessage({ ...args, perMarketCapUsdc: 50 }), signature }),
    false,
    "the same signature cannot approve a different cap",
  );
  assert.equal(
    verifyAgentSignature({ address: follower, message: followMessage({ ...args, signedAt: args.signedAt + 1 }), signature }),
    false,
    "nor a different timestamp",
  );
});

test("the compose message binds the creator, thesis and weights", () => {
  const creator = Keypair.generate().publicKey.toBase58();
  const base = { id: "contrarian-mix", name: "Contrarian", thesis: "Fade it.", creator, members, signedAt: 1 };
  const message = composeMessage(base);
  assert.ok(message.includes(`creator: ${creator}`));
  assert.match(message, /alpha: 5000 bps/);
  assert.notEqual(composeMessage({ ...base, thesis: "Follow it." }), message);
});

test("signatures expire after five minutes either way", () => {
  const now = 1_800_000_000_000;
  assert.ok(isFreshSignature(now - 60_000, now));
  assert.ok(!isFreshSignature(now - 6 * 60_000, now));
  assert.ok(!isFreshSignature(now + 6 * 60_000, now));
  assert.ok(!isFreshSignature(Number.NaN, now));
});

test("a follow cap is zero or between the program minimum and the ceiling", () => {
  assert.ok(isValidFollowCap(0));
  assert.ok(isValidFollowCap(2));
  assert.ok(isValidFollowCap(100));
  assert.ok(!isValidFollowCap(1.5), "below the 2 USDC minimum stake it could never mirror");
  assert.ok(!isValidFollowCap(101));
  assert.ok(!isValidFollowCap(-1));
  assert.ok(!isValidFollowCap(Number.NaN));
});

test("member input keeps only agentId and weightBps", () => {
  const out = sanitizeMembers([{ agentId: "alpha", weightBps: 5000, evil: "x" }]);
  assert.deepEqual(out, [{ agentId: "alpha", weightBps: 5000 }]);
  assert.deepEqual(sanitizeMembers("nope"), []);
});

test("member ids must look like agent ids or persona slugs", () => {
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "Alpha Beta", weightBps: 5_000 },
      { agentId: "beta", weightBps: 5_000 },
    ] })),
    "bad_agent_id",
  );
});

// ── Read-index claims → settlements and signals ────────────────────────────

const ALPHA = Keypair.generate().publicKey.toBase58();
const BETA = Keypair.generate().publicKey.toBase58();
const CREATOR = Keypair.generate().publicKey.toBase58();
const FOLLOWER = Keypair.generate().publicKey.toBase58();
const byWallet = new Map([[ALPHA, "alpha"], [BETA, "beta"]]);

function claim(over: Partial<IndexedClaim> = {}): IndexedClaim {
  return {
    id: 1,
    creator: CREATOR,
    state: 2,
    winner_side: 2,
    creator_stake: String(10n * ONE_USDC),
    total_challenger_stake: String(10n * ONE_USDC),
    deadline: 1_788_000_000,
    resolved_at: 0,
    max_challengers: 16,
    delegated: true,
    platform_fee_bps: 0,
    agent_fee_bps: 0,
    challengers: [{ addr: ALPHA, stake: String(10n * ONE_USDC) }],
    ...over,
  };
}

test("a challenger win pays its pool share of the creator stake, minus profit-only fees", () => {
  const ch = { addr: ALPHA, stake: String(10n * ONE_USDC) };
  assert.equal(challengerPnlUnits(claim(), ch), 10n * ONE_USDC);
  // 1% total fee on the 10 USDC profit.
  assert.equal(
    challengerPnlUnits(claim({ platform_fee_bps: 50, agent_fee_bps: 50 }), { ...ch, agent: BETA }),
    10n * ONE_USDC - 100_000n,
  );
  // The agent leg is waived when the agent is the winner itself.
  assert.equal(challengerPnlUnits(claim({ agent_fee_bps: 50 }), { ...ch, agent: ALPHA }), 10n * ONE_USDC);
});

test("a creator win costs the stake; draws and unresolvable verdicts are free", () => {
  const ch = { addr: ALPHA, stake: String(4n * ONE_USDC) };
  assert.equal(challengerPnlUnits(claim({ winner_side: 1 }), ch), -4n * ONE_USDC);
  assert.equal(challengerPnlUnits(claim({ winner_side: 3, platform_fee_bps: 50 }), ch), 0n);
  assert.equal(challengerPnlUnits(claim({ winner_side: 4 }), ch), 0n);
});

test("only RESOLVED claims settle: proposed, disputed and cancelled do not", () => {
  const claims = [2, 3, 4, 5].map((state, i) => claim({ id: i + 1, state }));
  const out = settlementsFromClaims(claims, byWallet);
  assert.equal(out.length, 1);
  assert.equal(out[0].agentId, "alpha");
});

test("settlements are dated by resolved_at, falling back to the deadline", () => {
  const [a] = settlementsFromClaims([claim({ resolved_at: 1_788_100_000 })], byWallet);
  const [b] = settlementsFromClaims([claim({ resolved_at: 0 })], byWallet);
  assert.equal(a.day, new Date(1_788_100_000 * 1000).toISOString().slice(0, 10));
  assert.equal(b.day, new Date(1_788_000_000 * 1000).toISOString().slice(0, 10));
});

test("strangers in a claim are ignored when settling", () => {
  const out = settlementsFromClaims(
    [claim({ challengers: [{ addr: CREATOR, stake: "5000000" }, { addr: BETA, stake: "3000000" }] })],
    byWallet,
  );
  assert.deepEqual(out.map((s) => s.agentId), ["beta"]);
});

const NOW = 1_788_000_000 - 3_600;

test("a live member position becomes a signal capped by the follower's cap", () => {
  const signals = mirrorSignals({
    claims: [claim({ state: 1 })],
    agentByWallet: byWallet,
    follower: FOLLOWER,
    perMarketCapUsdc: 3,
    nowSec: NOW,
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].suggestedStakeUnits, String(3n * ONE_USDC));
  assert.equal(signals[0].layer, "er");
  assert.deepEqual(signals[0].members.map((m) => m.agentId), ["alpha"]);
});

test("the copy never exceeds what the member itself staked", () => {
  const [s] = mirrorSignals({
    claims: [claim({ state: 0, challengers: [{ addr: BETA, stake: String(2n * ONE_USDC) }] })],
    agentByWallet: byWallet,
    follower: FOLLOWER,
    perMarketCapUsdc: 50,
    nowSec: NOW,
  });
  assert.equal(s.suggestedStakeUnits, String(2n * ONE_USDC));
});

test("no signal for closed, expired, full, own or already-copied claims", () => {
  const base = { agentByWallet: byWallet, follower: FOLLOWER, perMarketCapUsdc: 5, nowSec: NOW };
  const none = (c: IndexedClaim) => mirrorSignals({ ...base, claims: [c] }).length === 0;
  assert.ok(none(claim({ state: 4 })), "proposed");
  assert.ok(none(claim({ state: 1, deadline: NOW - 1 })), "expired");
  assert.ok(none(claim({ state: 1, max_challengers: 1 })), "full");
  assert.ok(none(claim({ state: 1, creator: FOLLOWER })), "the follower's own claim");
  assert.ok(
    none(claim({ state: 1, challengers: [{ addr: ALPHA, stake: "5000000" }, { addr: FOLLOWER, stake: "2000000" }] })),
    "already copied",
  );
  assert.ok(none(claim({ state: 1, challengers: [{ addr: CREATOR, stake: "5000000" }] })), "no member in it");
});

test("a cap below the minimum stake mirrors nothing", () => {
  const signals = mirrorSignals({
    claims: [claim({ state: 1 })],
    agentByWallet: byWallet,
    follower: FOLLOWER,
    perMarketCapUsdc: 1,
    nowSec: NOW,
  });
  assert.equal(signals.length, 0);
});

test("worst-case follower exposure is the cap across every member", () => {
  assert.equal(worstCaseFollowerExposure(members, 5), 10);
  assert.equal(worstCaseFollowerExposure(members, 0), 0, "unfollowing caps exposure at zero");
});

test("the weight total constant matches what validation enforces", () => {
  assert.equal(members.reduce((a, m) => a + m.weightBps, 0), WEIGHT_TOTAL_BPS);
});
