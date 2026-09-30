import assert from "node:assert/strict";
import test from "node:test";

import {
  activeFilterCount,
  applyFilters,
  DEFAULT_FILTERS,
  feedCategories,
  feedTotals,
  hasNarrowing,
  parseMinStake,
  poolOf,
  viewClaims,
  type FeedClaim,
} from "../../lib/arena-feed";

const NOW = 1_800_000_000;

function claim(over: Partial<FeedClaim>): FeedClaim {
  return {
    id: 1,
    question: "Will SOL close above $250?",
    category: "crypto",
    creatorStake: "5000000",
    totalChallengerStake: "0",
    deadline: NOW + 3_600,
    state: 0,
    delegated: false,
    ...over,
  };
}

const feed: FeedClaim[] = [
  claim({ id: 1 }),
  claim({ id: 2, state: 1, delegated: true, totalChallengerStake: "20000000", category: "sports", question: "Will Arsenal win?" }),
  claim({ id: 3, state: 1, deadline: NOW - 10 }),
  claim({ id: 4, state: 4, totalChallengerStake: "1000000" }),
  claim({ id: 5, state: 2 }),
  claim({ id: 6, state: 3 }),
  claim({ id: 7, state: 5, creatorStake: "100000000" }),
];

test("poolOf adds both sides in USDC", () => {
  assert.equal(poolOf(claim({ creatorStake: "5000000", totalChallengerStake: "2500000" })), 7.5);
});

test("views split live, rollup and settled claims", () => {
  const ids = (view: "open" | "live" | "resolved") => viewClaims(feed, view, DEFAULT_FILTERS, NOW).map((c) => c.id);
  assert.deepEqual(ids("open"), [2, 1]);
  assert.deepEqual(ids("live"), [2]);
  // PROPOSED, DISPUTED, RESOLVED and CANCELLED are all off the live board.
  assert.deepEqual(ids("resolved"), [7, 6, 5, 4]);
});

test("filters narrow by category, minimum creator stake and search; sort by pool", () => {
  assert.deepEqual(applyFilters(feed, { ...DEFAULT_FILTERS, category: "sports" }).map((c) => c.id), [2]);
  assert.deepEqual(applyFilters(feed, { ...DEFAULT_FILTERS, minStake: 25 }).map((c) => c.id), [7]);
  assert.deepEqual(applyFilters(feed, { ...DEFAULT_FILTERS, search: "arsenal" }).map((c) => c.id), [2]);
  assert.equal(applyFilters(feed, { ...DEFAULT_FILTERS, sort: "pool" })[0].id, 7);
});

test("filter counts ignore sort; search counts as narrowing", () => {
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, sort: "pool" }), 0);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, category: "crypto", minStake: 5 }), 2);
  assert.equal(hasNarrowing({ ...DEFAULT_FILTERS, search: " sol " }), true);
  assert.equal(hasNarrowing(DEFAULT_FILTERS), false);
});

test("categories and totals come from the feed", () => {
  assert.deepEqual(feedCategories(feed), ["crypto", "sports"]);
  const totals = feedTotals(feed, NOW);
  assert.equal(totals.open, 2);
  // Escrowed: open, active (also past deadline), proposed, disputed.
  assert.equal(totals.inPlay, 5 + 25 + 5 + 6 + 100);
});

test("parseMinStake accepts commas and rejects junk", () => {
  assert.equal(parseMinStake("12,5"), 12.5);
  assert.equal(parseMinStake("abc"), 0);
  assert.equal(parseMinStake("-3"), 0);
  assert.equal(parseMinStake(""), 0);
});
