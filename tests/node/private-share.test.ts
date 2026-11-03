import assert from "node:assert/strict";
import test from "node:test";
import { betCaption, betIntentUrl } from "../../lib/bet-share";

test("private post-stake sharing explains wallet approval while public sharing is unchanged", () => {
  const caption = betCaption("Will this happen?", "Yes", "$10", true);
  assert.match(caption, /Only creator-approved wallets can join/);
  assert.doesNotMatch(caption, /Think I'm wrong\? Take the other side/);
  const intent = new URL(betIntentUrl("vs", 45, 2, "Will this happen?", "No", "$10", undefined, "base", true));
  assert.match(intent.searchParams.get("text")!, /Only creator-approved wallets can join/);
  assert.match(intent.searchParams.get("url")!, /\/b\/base-vs-45\?side=2$/);
  assert.match(betCaption("Will this happen?", "Yes", "$10"), /Think I'm wrong\? Take the other side/);
});
