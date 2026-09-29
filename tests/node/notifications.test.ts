import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { claimEvents, isRetryableStatus, webhookMessage, type ClaimSnapshot } from "../../lib/notifications";
import { webhookSignature } from "../../lib/server/notifications";

const CREATOR = "CreatorPubkey1111111111111111111111111111111";
const A = "ChallengerA11111111111111111111111111111111";
const B = "ChallengerB11111111111111111111111111111111";

const claim: ClaimSnapshot = {
  id: 9,
  creator: CREATOR,
  question: "Will it?",
  state: 1,
  winner_side: 0,
  creator_stake: "10000000",
  total_challenger_stake: "8000000",
  challengers: [
    { addr: A, stake: "5000000", paid: false },
    { addr: B, stake: "3000000", paid: false },
  ],
};
const prior = (state: number, n = 2) => ({ state, challengers: claim.challengers.slice(0, n) });

test("a new challenge notifies the creator once per challenger count", () => {
  const events = claimEvents(prior(1, 1), claim);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "challenged");
  assert.equal(events[0].recipient, CREATOR, "base58 recipient is never lowercased");
  assert.equal(events[0].dedupe, "count:2");
  assert.equal(events[0].payload.challenger, B);
});

test("a proposal notifies every participant with what it means for them", () => {
  const events = claimEvents(prior(1), { ...claim, state: 4, proposed_side: 1, disputable_until: 123 });
  assert.deepEqual(events.map((e) => e.recipient).sort(), [A, B, CREATOR].sort());
  assert.ok(events.every((e) => e.kind === "proposed" && e.payload.disputableUntil === 123));
  assert.equal(events.find((e) => e.recipient === CREATOR)!.payload.youWinIfFinal, true);
  assert.equal(events.find((e) => e.recipient === A)!.payload.youWinIfFinal, false);
});

test("a dispute notifies every participant", () => {
  const events = claimEvents(prior(4), { ...claim, state: 5, disputer: A });
  assert.equal(events.length, 3);
  assert.ok(events.every((e) => e.kind === "disputed" && e.payload.disputer === A));
});

test("resolution notifies participants with the outcome and each unpaid winning leg as claimable", () => {
  const events = claimEvents(prior(4), { ...claim, state: 2, winner_side: 2, confidence: 90 });
  const resolved = events.filter((e) => e.kind === "resolved");
  assert.equal(resolved.length, 3);
  assert.equal(resolved.find((e) => e.recipient === CREATOR)!.payload.youWon, false);
  assert.equal(resolved.find((e) => e.recipient === A)!.payload.youWon, true);

  const claimable = events.filter((e) => e.kind === "payout_claimable");
  assert.deepEqual(claimable.map((e) => e.recipient).sort(), [A, B].sort());
  // Pool odds: 5 + 5/8 * 10 = 11.25 USDC gross.
  assert.equal(claimable.find((e) => e.recipient === A)!.payload.grossUnits, "11250000");
});

test("an unresolvable settlement is a refund: no winner, every leg claimable, paid legs skipped", () => {
  const events = claimEvents(prior(1), {
    ...claim,
    state: 2,
    winner_side: 4,
    challengers: [claim.challengers[0], { ...claim.challengers[1], paid: true }],
  });
  assert.ok(events.filter((e) => e.kind === "resolved").every((e) => e.payload.youWon === null));
  assert.deepEqual(events.filter((e) => e.kind === "payout_claimable").map((e) => e.dedupe).sort(), ["challenger:0", "creator"]);
});

test("a cancellation notifies the creator", () => {
  const open = { ...claim, state: 0, challengers: [] };
  const events = claimEvents({ state: 0, challengers: [] }, { ...open, state: 3 });
  assert.deepEqual(events.map((e) => [e.kind, e.recipient]), [["cancelled", CREATOR]]);
});

test("first sight and unchanged claims produce nothing", () => {
  assert.deepEqual(claimEvents(null, claim), []);
  assert.deepEqual(claimEvents(prior(1), claim), []);
  assert.deepEqual(claimEvents(prior(2), { ...claim, state: 2, winner_side: 1 }), []);
});

test("webhook message binds address, url and time; deliveries carry an hmac of the raw body", () => {
  assert.equal(
    webhookMessage(CREATOR, "", 5),
    `Mimir notifications webhook\naddress: ${CREATOR}\nurl: (remove)\nsignedAt: 5`,
  );
  const body = '{"id":1}';
  assert.equal(webhookSignature("s3cret", body), `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`);
});

test("only network errors, 429 and 5xx are retried", () => {
  assert.equal(isRetryableStatus(null), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(0), false);
});
