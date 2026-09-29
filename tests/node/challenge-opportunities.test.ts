import assert from "node:assert/strict";
import test from "node:test";

import type { ChallengeOpportunity, SourceClaimDraftCandidate } from "../../lib/claimDrafts";
import {
  clampLimit,
  findExistingOpportunityClaim,
  getChallengeOpportunities,
  liveSeedOpportunities,
  opportunityExpiresAt,
  sortOpportunities,
  type ExistingClaim,
} from "../../lib/server/challenge-opportunities";

const NOW_SEC = 1_777_000_000;

const BASE_CANDIDATE: SourceClaimDraftCandidate = {
  category: "crypto",
  claimText: "Will BTC close above $120,000 before April 30, 2026?",
  sideA: "BTC closes above $120,000 before April 30, 2026",
  sideB: "BTC does not close above $120,000 before April 30, 2026",
  deadlineAt: "2026-04-30T23:00:00.000Z",
  timezone: "UTC",
  primaryResolutionSource: "https://www.coingecko.com/en/coins/bitcoin",
  settlementRule:
    "Resolve this using the visible spot price on the linked source at the deadline time. If BTC is above the threshold, Side A wins.",
  ambiguityFlags: [],
  confidenceScore: 88,
};

const BASE_CLAIM: ExistingClaim = {
  id: 42,
  question: "Will BTC close above $120,000 before April 30, 2026?",
  creatorPosition: "BTC closes above $120,000 before April 30, 2026",
  counterPosition: "BTC does not close above $120,000 before April 30, 2026",
  resolutionUrl: "https://www.coingecko.com/en/coins/bitcoin",
  state: 0,
  deadline: NOW_SEC + 3600,
};

test("findExistingOpportunityClaim matches an open claim by question and source", () => {
  assert.equal(findExistingOpportunityClaim(BASE_CANDIDATE, [BASE_CLAIM], NOW_SEC)?.id, 42);
});

test("findExistingOpportunityClaim falls back to matching positions and source", () => {
  const candidate = { ...BASE_CANDIDATE, claimText: "Will Bitcoin finish above the threshold before month-end?" };
  assert.equal(findExistingOpportunityClaim(candidate, [BASE_CLAIM], NOW_SEC)?.id, 42);
});

test("findExistingOpportunityClaim ignores the resolver fragment on the claim url", () => {
  const claim = { ...BASE_CLAIM, resolutionUrl: `${BASE_CLAIM.resolutionUrl}#mimir=price:BTC:gt:120000` };
  assert.equal(findExistingOpportunityClaim(BASE_CANDIDATE, [claim], NOW_SEC)?.id, 42);
});

test("findExistingOpportunityClaim ignores claims from different sources", () => {
  const other = { ...BASE_CLAIM, id: 99, resolutionUrl: "https://coinmarketcap.com/currencies/bitcoin/" };
  assert.equal(findExistingOpportunityClaim(BASE_CANDIDATE, [other], NOW_SEC), undefined);
});

test("findExistingOpportunityClaim ignores settled and expired claims", () => {
  assert.equal(findExistingOpportunityClaim(BASE_CANDIDATE, [{ ...BASE_CLAIM, state: 2 }], NOW_SEC), undefined);
  assert.equal(findExistingOpportunityClaim(BASE_CANDIDATE, [{ ...BASE_CLAIM, deadline: NOW_SEC - 1 }], NOW_SEC), undefined);
});

test("an opportunity expires at its deadline or after a day, whichever is first", () => {
  const generatedAt = Date.parse("2026-04-01T00:00:00.000Z");
  assert.equal(opportunityExpiresAt(BASE_CANDIDATE, generatedAt), generatedAt + 86_400_000);
  const soon = { ...BASE_CANDIDATE, deadlineAt: "2026-04-01T06:00:00.000Z" };
  assert.equal(opportunityExpiresAt(soon, generatedAt), Date.parse(soon.deadlineAt));
});

test("seeds past their deadline are not served", () => {
  const farFuture = Date.parse("2030-01-01T00:00:00.000Z");
  assert.deepEqual(liveSeedOpportunities([], farFuture), []);
});

test("challenge links sort ahead of create links, then by strength", () => {
  const make = (id: string, action: "create" | "challenge", score: number): ChallengeOpportunity => ({
    id,
    sourceUrl: "https://x.test",
    sourceType: "official",
    sourceSummary: "",
    candidate: BASE_CANDIDATE,
    claimStrengthScore: score,
    claimStrengthTier: "good",
    action,
  });
  const sorted = sortOpportunities([make("a", "create", 90), make("b", "challenge", 50), make("c", "create", 95)]);
  assert.deepEqual(sorted.map((o) => o.id), ["b", "c", "a"]);
});

test("the limit is clamped to a sane range", () => {
  assert.equal(clampLimit(undefined), 8);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(1000), 24);
  assert.equal(clampLimit(Number.NaN), 8);
});

test("without a database the read serves only unexpired seeds", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const res = await getChallengeOpportunities({ now: Date.parse("2030-01-01T00:00:00.000Z") });
    assert.equal(res.count, 0);
    assert.deepEqual(res.items, []);
  } finally {
    if (prev !== undefined) process.env.DATABASE_URL = prev;
  }
});
