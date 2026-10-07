import assert from "node:assert/strict";
import test from "node:test";

import { arcLandingFeed } from "../../lib/arc/landing";

const m = (over: object) => ({ kind: "pool" as const, marketId: 1, question: "q", category: "crypto", labelA: "Yes", labelB: "No", stakeA: "2000000000000000000", stakeB: "1000000000000000000", deadline: 9, status: "open" as const, winner: 0, summary: "", participants: 2, ...over });

test("arc markets become the landing feed: 6-dp units, live pool only, readable labels", () => {
  const feed = arcLandingFeed([m({}), m({ kind: "vs", marketId: 3, status: "resolved", winner: 1 })]);
  assert.equal(feed.claimCount, 2);
  assert.equal(feed.totalResolved, 1);
  assert.equal(feed.openPool, "3000000");
  assert.equal(feed.claims[0].creatorStake, "2000000");
  assert.equal(feed.claims[0].label, "Pool #1");
  assert.equal(feed.claims[1].href, "/arena/arc/vs/3");
  assert.notEqual(feed.claims[0].id, feed.claims[1].id);
});
