import assert from "node:assert/strict";
import test from "node:test";

import { baseScore, campaignJoinMessage, INVITE_CODE_PATTERN } from "../../lib/campaign";

const none = { volumeUsdc: 0, agents: 0, baskets: 0, follows: 0, copies: 0 };

test("each metric scores at its weight", () => {
  assert.equal(baseScore(none), 0);
  assert.equal(baseScore({ ...none, volumeUsdc: 12.5 }), 125);
  assert.equal(baseScore({ volumeUsdc: 1, agents: 1, baskets: 1, follows: 1, copies: 1 }), 10 + 500 + 300 + 100 + 50);
});

test("capped metrics stop counting at the cap", () => {
  assert.equal(baseScore({ ...none, agents: 50 }), 5 * 500);
  assert.equal(baseScore({ ...none, follows: 100 }), 20 * 100);
  assert.equal(baseScore({ ...none, copies: 100 }), 100 * 50);
});

test("the join message names the invite code, or none", () => {
  assert.match(campaignJoinMessage("W", "ABCD1234"), /invited by: ABCD1234$/);
  assert.match(campaignJoinMessage("W", null), /invited by: none$/);
  assert.ok(INVITE_CODE_PATTERN.test("ABCD1234"));
  assert.ok(!INVITE_CODE_PATTERN.test("abcd1234"));
});
