import assert from "node:assert/strict";
import test from "node:test";

import {
  creatorShare,
  featuredClaim,
  ledgerEntries,
  liveStats,
  poolUsdc,
  tickerClaims,
  timeLeft,
  type LandingClaim,
  type LandingFeed,
} from "../../lib/landing";

const NOW = 1_800_000_000;

function claim(over: Partial<LandingClaim>): LandingClaim {
  return {
    id: 1,
    question: "Will it?",
    category: "crypto",
    creatorPosition: "Yes",
    counterPosition: "No",
    creatorStake: "3000000",
    totalChallengerStake: "0",
    deadline: NOW + 3_600,
    state: 0,
    winnerSide: 0,
    confidence: 0,
    resolutionSummary: "",
    delegated: true,
    challengers: [],
    ...over,
  };
}

const feed = (claims: LandingClaim[], extra: Partial<LandingFeed> = {}): LandingFeed => ({
  claims,
  claimCount: claims.length,
  totalResolved: claims.filter((c) => c.state === 2).length,
  openPool: "0",
  ...extra,
});

test("liveStats is all zeros without a feed and counts only live delegated claims", () => {
  assert.deepEqual(liveStats(null), { markets: 0, resolved: 0, openPool: 0, liveOnEr: 0 });
  const f = feed(
    [
      claim({ id: 1, state: 0, delegated: true }),
      claim({ id: 2, state: 1, delegated: false }),
      claim({ id: 3, state: 2, delegated: true, winnerSide: 1 }),
    ],
    { openPool: "12500000" },
  );
  assert.deepEqual(liveStats(f), { markets: 3, resolved: 1, openPool: 12.5, liveOnEr: 1 });
});

test("poolUsdc and creatorShare read base units", () => {
  const c = claim({ creatorStake: "3000000", totalChallengerStake: "9000000" });
  assert.equal(poolUsdc(c), 12);
  assert.equal(creatorShare(c), 0.25);
  assert.equal(creatorShare(claim({ creatorStake: "0" })), 0.5);
});

test("tickerClaims is newest first and capped", () => {
  const f = feed([claim({ id: 2 }), claim({ id: 9 }), claim({ id: 5 })]);
  assert.deepEqual(tickerClaims(f, 2).map((c) => c.id), [9, 5]);
  assert.deepEqual(tickerClaims(null), []);
});

test("featuredClaim prefers an open claim with the biggest pool, then anything holding stakes", () => {
  const f = feed([
    claim({ id: 1, state: 1, totalChallengerStake: "1000000" }),
    claim({ id: 2, state: 1, totalChallengerStake: "9000000" }),
    claim({ id: 3, state: 1, totalChallengerStake: "99000000", deadline: NOW - 10 }),
    claim({ id: 4, state: 2, winnerSide: 1 }),
  ]);
  assert.equal(featuredClaim(f, NOW)?.id, 2);
  const expired = feed([claim({ id: 7, state: 4, deadline: NOW - 10 }), claim({ id: 8, state: 2, winnerSide: 2 })]);
  assert.equal(featuredClaim(expired, NOW)?.id, 7);
  assert.equal(featuredClaim(feed([claim({ state: 3 })]), NOW), null);
  assert.equal(featuredClaim(null, NOW), null);
});

test("ledgerEntries keeps resolved claims, newest verdict first, with a firmness tag", () => {
  const f = feed([
    claim({ id: 1, state: 2, winnerSide: 2, confidence: 92, resolvedAt: 10 }),
    claim({ id: 2, state: 2, winnerSide: 4, confidence: 0, resolvedAt: 30, resolutionSummary: "Refunded: grace" }),
    claim({ id: 3, state: 2, winnerSide: 1, confidence: 70, resolvedAt: 20 }),
    claim({ id: 4, state: 1 }),
  ]);
  const out = ledgerEntries(f);
  assert.deepEqual(out.map((e) => e.claim.id), [2, 3, 1]);
  assert.deepEqual(out.map((e) => e.tag), ["refund", "contested", "firm"]);
  assert.deepEqual(ledgerEntries(null), []);
});

test("timeLeft reads days, hours and minutes and says closed after the deadline", () => {
  assert.equal(timeLeft(NOW + 2 * 86_400 + 4 * 3_600, NOW), "2d 4h");
  assert.equal(timeLeft(NOW + 3 * 3_600 + 12 * 60, NOW), "3h 12m");
  assert.equal(timeLeft(NOW + 30, NOW), "1m");
  assert.equal(timeLeft(NOW - 1, NOW), "closed");
});
