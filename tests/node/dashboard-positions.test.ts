import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDashboardFilters,
  claimableLegs,
  DEFAULT_DASHBOARD_FILTERS,
  parseDashboardFilters,
  positionOutcome,
  positionRole,
  positionStake,
  serializeDashboardFilters,
  summarizePositions,
  type PositionClaim,
} from "../../lib/dashboard-positions";

const ME = "Viewer1111111111111111111111111111111111111";
const OTHER = "Other11111111111111111111111111111111111111";

const base: PositionClaim = {
  id: 1,
  creator: OTHER,
  question: "Will SOL close above 200?",
  category: "crypto",
  state: 1,
  winnerSide: 0,
  creatorStake: "10000000",
  totalChallengerStake: "10000000",
  platformFeeBps: 0,
  agentFeeBps: 0,
  challengers: [{ addr: ME, stake: "10000000", paid: false }],
};

test("role, stake and outcome follow the viewer's side", () => {
  assert.equal(positionRole(base, ME), "challenger");
  assert.equal(positionRole({ ...base, creator: ME, challengers: [] }, ME), "creator");
  assert.equal(positionRole(base, "Nobody111111111111111111111111111111111111"), null);
  assert.equal(positionStake({ ...base, challengers: [...base.challengers, { addr: ME, stake: "2000000", paid: false }] }, ME), 12_000_000n);
  assert.equal(positionOutcome(base, ME), "open");
  assert.equal(positionOutcome({ ...base, state: 4 }, ME), "pending");
  assert.equal(positionOutcome({ ...base, state: 2, winnerSide: 2 }, ME), "won");
  assert.equal(positionOutcome({ ...base, state: 2, winnerSide: 1 }, ME), "lost");
  assert.equal(positionOutcome({ ...base, state: 2, winnerSide: 4 }, ME), "refund");
  assert.equal(positionOutcome({ ...base, state: 3 }, ME), "cancelled");
});

test("claimable legs are the viewer's unpaid winning legs with profit-only fees", () => {
  const won = { ...base, state: 2, winnerSide: 2, platformFeeBps: 100 };
  const [leg] = claimableLegs(won, ME);
  assert.equal(leg.role, "challenger");
  assert.equal(leg.index, 0);
  assert.equal(leg.gross, 20_000_000n);
  // 1% of the 10 USDC profit.
  assert.equal(leg.net, 19_900_000n);
  assert.deepEqual(claimableLegs({ ...won, challengers: [{ ...base.challengers[0], paid: true }] }, ME), []);
  assert.deepEqual(claimableLegs({ ...won, winnerSide: 1 }, ME), [], "a losing leg pays nothing");
  assert.deepEqual(claimableLegs({ ...base, state: 4 }, ME), [], "only RESOLVED claims pay out");
  const refund = claimableLegs({ ...won, winnerSide: 4 }, ME);
  assert.equal(refund[0].net, 10_000_000n, "a refund is never charged");
});

test("filters round-trip through the URL and apply tab, category, min stake and search", () => {
  const cats = ["crypto", "sports"];
  const f = parseDashboardFilters(new URLSearchParams("tab=settling&cat=Crypto&min=5&q=sol"), cats);
  assert.deepEqual(f, { tab: "settling", cat: "crypto", minStake: 5, search: "sol" });
  assert.equal(serializeDashboardFilters(f), "tab=settling&cat=crypto&min=5&q=sol");
  assert.equal(serializeDashboardFilters(DEFAULT_DASHBOARD_FILTERS), "");
  assert.deepEqual(parseDashboardFilters(new URLSearchParams("tab=x&cat=nope&min=7"), cats), DEFAULT_DASHBOARD_FILTERS);

  const claims = [base, { ...base, id: 2, state: 4 }, { ...base, id: 3, state: 2, winnerSide: 2, category: "sports" }];
  assert.deepEqual(applyDashboardFilters(claims, { ...DEFAULT_DASHBOARD_FILTERS, tab: "settling" }, ME).map((c) => c.id), [2]);
  assert.deepEqual(applyDashboardFilters(claims, { ...DEFAULT_DASHBOARD_FILTERS, cat: "sports" }, ME).map((c) => c.id), [3]);
  assert.deepEqual(applyDashboardFilters(claims, { ...DEFAULT_DASHBOARD_FILTERS, minStake: 25 }, ME), []);
  assert.deepEqual(applyDashboardFilters(claims, { ...DEFAULT_DASHBOARD_FILTERS, search: "#3" }, ME).map((c) => c.id), [3]);
});

test("summary counts outcomes, capital at risk and net winnings, paid or not", () => {
  const claims = [
    base,
    { ...base, id: 2, state: 4 },
    { ...base, id: 3, state: 2, winnerSide: 2, challengers: [{ addr: ME, stake: "10000000", paid: true }] },
    { ...base, id: 4, state: 2, winnerSide: 1 },
  ];
  const s = summarizePositions(claims, ME);
  assert.equal(s.total, 4);
  assert.equal(s.won, 1);
  assert.equal(s.lost, 1);
  assert.equal(s.winRate, 50);
  assert.equal(s.atRisk, 20_000_000n);
  assert.equal(s.totalWon, 20_000_000n);
  assert.deepEqual(s.counts, { active: 1, settling: 1, done: 2 });
});
