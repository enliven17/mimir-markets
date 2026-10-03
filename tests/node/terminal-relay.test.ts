import test from "node:test";
import assert from "node:assert/strict";

import { parseRelayReply, relaySignature, verifyRelaySignature, RELAY_MAX_SKEW_MS } from "../../lib/terminal/relay";
import { verifyMimirRequest } from "../../sdk/agents";

const secret = "s3cret";
const body = JSON.stringify({ message: "is SOL going up?" });
const now = 1_800_000_000_000;

test("an agent accepts a fresh, untouched, correctly signed request and nothing else", () => {
  const sig = relaySignature(secret, now, body);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verifyRelaySignature({ secret, timestamp: now, signature: sig, rawBody: body, now }), true);
  assert.equal(verifyRelaySignature({ secret, timestamp: String(now), signature: sig, rawBody: body, now: now + 1000 }), true, "headers are strings");
  assert.equal(verifyRelaySignature({ secret, timestamp: now, signature: sig, rawBody: body + " ", now }), false, "body changed");
  assert.equal(verifyRelaySignature({ secret: "other", timestamp: now, signature: sig, rawBody: body, now }), false, "wrong secret");
  assert.equal(verifyRelaySignature({ secret, timestamp: now + 1, signature: sig, rawBody: body, now }), false, "timestamp is signed too");
  assert.equal(verifyRelaySignature({ secret, timestamp: now, signature: sig, rawBody: body, now: now + RELAY_MAX_SKEW_MS + 1 }), false, "replayed later");
  assert.equal(verifyRelaySignature({ secret, timestamp: null, signature: sig, rawBody: body, now }), false);
  assert.equal(verifyRelaySignature({ secret, timestamp: now, signature: undefined, rawBody: body, now }), false);
  assert.equal(verifyMimirRequest, verifyRelaySignature, "the SDK exports the same check");
});

test("an agent reply is read from JSON or plain text, cleaned and capped", () => {
  assert.equal(parseRelayReply('{"reply":"  Lean yes.  "}', "application/json", 100), "Lean yes.");
  assert.equal(parseRelayReply("Plain answer", "text/plain", 100), "Plain answer");
  assert.equal(parseRelayReply('{"answer":"wrong key"}', "application/json", 100), null);
  assert.equal(parseRelayReply("{not json", "application/json", 100), null);
  assert.equal(parseRelayReply("bell\u0007 and esc\u001b[31m", "text/plain", 100), "bell and esc[31m", "control characters go");
  assert.equal(parseRelayReply("x".repeat(500), "text/plain", 10), "x".repeat(10));
  assert.equal(parseRelayReply("   ", "text/plain", 10), null);
});
