import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";

import {
  evaluateCopy,
  validateCopyPermission,
  copyPermissionMessage,
  followerProofMessage,
  worstCaseCopySpend,
  copyStakeUnits,
  isFreshCopySignature,
  InvalidCopyPermissionError,
  COPY_SKIP_REASONS,
  MAX_SIGNAL_AGE_MS,
  type CopyPermission,
  type CopySignal,
  type CopyUsage,
} from "../../lib/copy-trading";
import { candidateSignals, claimsHeldBy, planCopies } from "../../lib/copy-signals";
import { usageFromPositions } from "../../lib/copy-trading-store";
import { signAgentMessage, verifyAgentSignature } from "../../lib/agents/signature";
import type { IndexedClaim } from "../../lib/baskets";

const NOW = 1_700_000_000_000;
const FOLLOWER = Keypair.generate();

function permission(over: Partial<CopyPermission> = {}): CopyPermission {
  return {
    id: "perm-1",
    follower: FOLLOWER.publicKey.toBase58(),
    signalAgentId: "statistician",
    executionAgentId: "my-agent",
    active: true,
    expiresAt: NOW + 7 * 24 * 3600 * 1000,
    maxPerPositionUsdc: 2,
    maxDailyUsdc: 10,
    maxWeeklyUsdc: 40,
    maxOpenExposureUsdc: 20,
    maxRealizedLossUsdc: 15,
    allowedCategories: [],
    minClaimQuality: 70,
    minPayoutRatio: 1.2,
    signedAt: NOW,
    signature: "sig",
    createdAt: NOW,
    ...over,
  };
}

function signal(over: Partial<CopySignal> = {}): CopySignal {
  return {
    signalAgentId: "statistician",
    claimId: 42,
    category: "crypto",
    stakeUsdc: 5,
    claimQuality: 85,
    payoutRatio: 1.9,
    placedAt: NOW - 1000,
    ...over,
  };
}

function usage(over: Partial<CopyUsage> = {}): CopyUsage {
  return {
    spentTodayUsdc: 0,
    spentThisWeekUsdc: 0,
    openExposureUsdc: 0,
    realizedLossUsdc: 0,
    heldClaimIds: [],
    ...over,
  };
}

const run = (over: {
  permission?: Partial<CopyPermission>;
  signal?: Partial<CopySignal>;
  usage?: Partial<CopyUsage>;
  globallyPaused?: boolean;
} = {}) =>
  evaluateCopy({
    permission: permission(over.permission),
    signal: signal(over.signal),
    usage: usage(over.usage),
    now: NOW,
    globallyPaused: over.globallyPaused,
  });

test("a clean signal is copied, sized down to the per-position cap", () => {
  const d = run();
  assert.equal(d.allowed, true);
  assert.equal(d.stakeUsdc, 2, "a 5 USDC signal under a 2 USDC ceiling copies at 2");
});

test("the gate is deterministic", () => {
  const first = run({ usage: { spentTodayUsdc: 10 } });
  for (let i = 0; i < 5; i++) assert.deepEqual(run({ usage: { spentTodayUsdc: 10 } }), first);
});

test("a global pause beats every other consideration", () => {
  assert.equal(run({ globallyPaused: true }).reason, "globally_paused");
});

test("an inactive or expired permission never executes", () => {
  assert.equal(run({ permission: { active: false } }).reason, "permission_inactive");
  assert.equal(run({ permission: { expiresAt: NOW - 1 } }).reason, "permission_expired");
  assert.equal(run({ permission: { expiresAt: NOW } }).reason, "permission_expired", "expiry is inclusive");
});

test("an agent cannot copy itself", () => {
  assert.equal(run({ permission: { executionAgentId: "statistician" } }).reason, "self_copy");
});

test("copy depth is 1 and cycles are refused", () => {
  assert.equal(run({ signal: { ancestry: ["someone-else"] } }).reason, "depth_exceeded");
  assert.equal(run({ signal: { ancestry: [] } }).allowed, true);
});

test("a position already held is not duplicated", () => {
  assert.equal(run({ usage: { heldClaimIds: [42] } }).reason, "duplicate_position");
  assert.equal(run({ usage: { heldClaimIds: [41, 43] } }).allowed, true);
});

test("a stale signal is refused at the boundary", () => {
  assert.equal(run({ signal: { placedAt: NOW - MAX_SIGNAL_AGE_MS } }).allowed, true);
  assert.equal(run({ signal: { placedAt: NOW - MAX_SIGNAL_AGE_MS - 1 } }).reason, "stale_signal");
});

test("an empty category allowlist allows everything; a populated one excludes the rest", () => {
  assert.equal(run({ signal: { category: "weather" } }).allowed, true);
  assert.equal(
    run({ permission: { allowedCategories: ["sports"] }, signal: { category: "crypto" } }).reason,
    "category_not_allowed",
  );
  assert.equal(run({ permission: { allowedCategories: ["crypto"] } }).allowed, true);
});

test("claim-quality and payout floors are enforced at the boundary", () => {
  assert.equal(run({ signal: { claimQuality: 70 } }).allowed, true);
  assert.equal(run({ signal: { claimQuality: 69 } }).reason, "quality_below_floor");
  assert.equal(run({ signal: { payoutRatio: 1.2 } }).allowed, true);
  assert.equal(run({ signal: { payoutRatio: 1.19 } }).reason, "payout_below_floor");
});

test("the realized-loss ceiling stops copying for good", () => {
  assert.equal(run({ usage: { realizedLossUsdc: 15 } }).reason, "realized_loss_limit");
  assert.equal(run({ usage: { realizedLossUsdc: 14.99 } }).allowed, true);
});

test("a spent cap is named rather than silently sizing to zero", () => {
  assert.equal(run({ usage: { spentTodayUsdc: 10 } }).reason, "daily_cap");
  assert.equal(run({ usage: { spentThisWeekUsdc: 40 } }).reason, "weekly_cap");
  assert.equal(run({ usage: { openExposureUsdc: 20 } }).reason, "exposure_cap");
});

test("a partially spent cap sizes the copy down, but never below the program minimum", () => {
  const sized = run({ permission: { maxPerPositionUsdc: 5 }, usage: { spentTodayUsdc: 7 } });
  assert.equal(sized.allowed, true);
  assert.equal(sized.stakeUsdc, 3, "only 3 USDC of the daily cap is left");
  assert.equal(run({ usage: { spentTodayUsdc: 9 } }).reason, "below_min_stake");
});

test("the smallest binding cap wins", () => {
  const d = run({
    permission: { maxPerPositionUsdc: 5 },
    usage: { spentTodayUsdc: 4, spentThisWeekUsdc: 36.5, openExposureUsdc: 17.25 },
  });
  assert.equal(d.allowed, true);
  assert.equal(d.stakeUsdc, 2.75, "exposure headroom is the tightest of the three");
});

test("stake is rounded down to cents, never up, and converts exactly to base units", () => {
  const d = run({ permission: { maxPerPositionUsdc: 2.239 } });
  assert.equal(d.stakeUsdc, 2.23);
  assert.equal(copyStakeUnits(d.stakeUsdc), 2_230_000n);
  assert.equal(copyStakeUnits(0.29), 290_000n);
});

test("a refused copy always stakes zero and every reason is published", () => {
  const reasons = new Set<string>(COPY_SKIP_REASONS);
  for (const d of [
    run({ globallyPaused: true }),
    run({ permission: { active: false } }),
    run({ permission: { expiresAt: NOW - 1 } }),
    run({ permission: { executionAgentId: "statistician" } }),
    run({ signal: { ancestry: ["x"] } }),
    run({ usage: { heldClaimIds: [42] } }),
    run({ signal: { placedAt: 0 } }),
    run({ permission: { allowedCategories: ["sports"] } }),
    run({ signal: { claimQuality: 1 } }),
    run({ signal: { payoutRatio: 1 } }),
    run({ usage: { realizedLossUsdc: 99 } }),
    run({ usage: { spentTodayUsdc: 99 } }),
    run({ usage: { spentThisWeekUsdc: 99 } }),
    run({ usage: { openExposureUsdc: 99 } }),
    run({ usage: { openExposureUsdc: 19 } }),
  ]) {
    assert.equal(d.allowed, false);
    assert.equal(d.stakeUsdc, 0);
    assert.ok(reasons.has(d.reason!), `${d.reason} is not in COPY_SKIP_REASONS`);
  }
});

test("a permission must be internally coherent", () => {
  assert.doesNotThrow(() => validateCopyPermission(permission(), NOW));
  const bad: Array<Partial<CopyPermission>> = [
    { executionAgentId: "statistician" },
    { expiresAt: NOW - 1 },
    { expiresAt: NOW + 91 * 86_400_000 },
    { maxPerPositionUsdc: 0 },
    { maxPerPositionUsdc: 1.5 }, // below the program minimum stake
    { maxPerPositionUsdc: 11 }, // above the daily cap
    { maxDailyUsdc: 50 }, // above the weekly cap
    { minClaimQuality: 101 },
    { minPayoutRatio: 0.9 },
  ];
  for (const over of bad) {
    assert.throws(() => validateCopyPermission(permission(over), NOW), InvalidCopyPermissionError, JSON.stringify(over));
  }
});

test("worst-case spend is bounded by the weekly cap", () => {
  assert.equal(worstCaseCopySpend(permission()), 35);
  assert.equal(worstCaseCopySpend(permission({ maxWeeklyUsdc: 10 })), 10);
});

test("the signed message spells out every bound and keeps the base58 key exact", () => {
  const p = permission({ allowedCategories: ["crypto"] });
  const message = copyPermissionMessage(p);
  for (const fragment of [
    `follower: ${FOLLOWER.publicKey.toBase58()}`,
    "copy: statistician",
    "executed by: my-agent",
    "per position: 2 USDC",
    "per day: 10 USDC",
    "per week: 40 USDC",
    "open exposure: 20 USDC",
    "stop after losing: 15 USDC",
    "min claim quality: 70/100",
    "min payout: 1.2x",
    "categories: crypto",
    `signedAt: ${NOW}`,
    "Nothing is deposited",
  ]) {
    assert.ok(message.includes(fragment), `missing: ${fragment}`);
  }
  assert.match(copyPermissionMessage(permission()), /categories: any/);
});

test("grants and follower proofs verify as ed25519 over the exact message", () => {
  const message = copyPermissionMessage(permission());
  const signature = signAgentMessage(message, FOLLOWER.secretKey);
  const address = FOLLOWER.publicKey.toBase58();
  assert.equal(verifyAgentSignature({ address, message, signature }), true);
  assert.equal(
    verifyAgentSignature({ address, message: copyPermissionMessage(permission({ maxDailyUsdc: 11 })), signature }),
    false,
    "changing one bound breaks the signature",
  );
  const list = followerProofMessage("list", address, NOW);
  const revoke = followerProofMessage("revoke", address, NOW, "perm-1");
  assert.notEqual(list, revoke);
  assert.equal(
    verifyAgentSignature({ address, message: revoke, signature: signAgentMessage(list, FOLLOWER.secretKey) }),
    false,
    "a list proof cannot revoke",
  );
});

test("signatures are only fresh inside the five-minute window", () => {
  assert.equal(isFreshCopySignature(NOW - 299_000, NOW), true);
  assert.equal(isFreshCopySignature(NOW - 301_000, NOW), false);
  assert.equal(isFreshCopySignature(Number.NaN, NOW), false);
});

// ── Usage from the ledger ─────────────────────────────────────────────────

test("usage counts creator wins as losses, refunds as settled and v3 limbo as open", () => {
  const day = 24 * 3_600_000;
  const u = usageFromPositions(
    [
      { claimId: 1, stakeUsdc: 2, at: NOW - 1000, state: 1, winnerSide: 0 }, // ACTIVE
      { claimId: 2, stakeUsdc: 3, at: NOW - 2 * day, state: 2, winnerSide: 1 }, // creator won
      { claimId: 3, stakeUsdc: 4, at: NOW - 3 * day, state: 2, winnerSide: 2 }, // challengers won
      { claimId: 4, stakeUsdc: 5, at: NOW - 8 * day, state: 3, winnerSide: 0 }, // cancelled
      { claimId: 5, stakeUsdc: 6, at: NOW - 1000, state: 4, winnerSide: 0 }, // PROPOSED
      { claimId: 6, stakeUsdc: 7, at: NOW - 1000, state: 5, winnerSide: 0 }, // DISPUTED
      { claimId: 7, stakeUsdc: 8, at: NOW - 1000, state: null, winnerSide: 0 }, // not indexed
    ],
    NOW,
  );
  assert.equal(u.spentTodayUsdc, 2 + 6 + 7 + 8);
  assert.equal(u.spentThisWeekUsdc, 2 + 3 + 4 + 6 + 7 + 8);
  assert.equal(u.realizedLossUsdc, 3);
  assert.equal(u.openExposureUsdc, 2 + 6 + 7 + 8);
  assert.deepEqual(u.heldClaimIds, [1, 2, 3, 4, 5, 6, 7]);
});

// ── Signals from the read index ───────────────────────────────────────────

const SIGNAL_WALLET = Keypair.generate().publicKey.toBase58();
const EXECUTOR_WALLET = Keypair.generate().publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();
const NOW_SEC = Math.floor(NOW / 1000);

function claim(over: Partial<IndexedClaim> = {}): IndexedClaim {
  return {
    id: 42,
    creator: OTHER,
    state: 1,
    winner_side: 0,
    creator_stake: "10000000",
    total_challenger_stake: "5000000",
    deadline: NOW_SEC + 86_400,
    max_challengers: 8,
    delegated: true,
    challengers: [{ addr: SIGNAL_WALLET, stake: "5000000" }],
    question: "Will BTC close above $100,000 on the Coinbase daily candle for 2026-01-01?",
    category: "crypto",
    creator_position: "Yes, above",
    counter_position: "No, at or below",
    resolution_url: "https://www.coinbase.com/price/bitcoin",
    ...over,
  };
}

test("only live, joinable positions of the signal wallet become candidates", () => {
  const claims = [
    claim({ id: 1 }),
    claim({ id: 2, state: 4 }), // PROPOSED: no longer joinable
    claim({ id: 3, deadline: NOW_SEC - 1 }),
    claim({ id: 4, max_challengers: 1 }), // full
    claim({ id: 5, challengers: [{ addr: OTHER, stake: "2000000" }] }), // not the signal agent's
    claim({ id: 6, state: 0, delegated: false }),
  ];
  const out = candidateSignals({ claims, signalWallet: SIGNAL_WALLET, signalAgentId: "statistician", now: NOW });
  assert.deepEqual(out.map((c) => c.signal.claimId).sort(), [1, 6]);
  const one = out.find((c) => c.signal.claimId === 1)!;
  assert.equal(one.layer, "er");
  assert.equal(one.signal.stakeUsdc, 5);
  assert.equal(one.signal.payoutRatio, 3, "10 USDC against a 5 USDC challenger pool pays 3x gross");
  assert.ok(one.signal.claimQuality > 0);
  assert.equal(out.find((c) => c.signal.claimId === 6)!.layer, "base");
});

test("claims the executing wallet already sits in are held", () => {
  const claims = [
    claim({ id: 1 }),
    claim({ id: 2, creator: EXECUTOR_WALLET }),
    claim({ id: 3, challengers: [{ addr: SIGNAL_WALLET, stake: "1" }, { addr: EXECUTOR_WALLET, stake: "2" }] }),
  ];
  assert.deepEqual(claimsHeldBy(claims, EXECUTOR_WALLET), [2, 3]);
});

test("planning a batch consumes the caps as it allocates", () => {
  const claims = [1, 2, 3, 4, 5, 6].map((id) => claim({ id, deadline: NOW_SEC + 1000 + id }));
  const candidates = candidateSignals({ claims, signalWallet: SIGNAL_WALLET, signalAgentId: "statistician", now: NOW });
  const plan = planCopies({
    permission: permission({ minClaimQuality: 0, maxPerPositionUsdc: 4 }),
    candidates,
    usage: usage({ heldClaimIds: [3] }),
    now: NOW,
  });
  const allowed = plan.filter((p) => p.decision.allowed);
  assert.deepEqual(allowed.map((p) => [p.claimId, p.decision.stakeUsdc]), [[1, 4], [2, 4], [4, 2]]);
  assert.equal(plan.find((p) => p.claimId === 3)!.decision.reason, "duplicate_position");
  assert.equal(plan.find((p) => p.claimId === 5)!.decision.reason, "daily_cap");
});
