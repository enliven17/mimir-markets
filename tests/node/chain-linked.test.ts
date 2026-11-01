import assert from "node:assert/strict";
import test from "node:test";

import { groupLegs, missingChains, pairKeyOf, pairWaits, reuseDecision, siblingDecision, takeReuse, type LinkedVerdict } from "../../lib/chains/linked";

const verdict = (v: Partial<LinkedVerdict> & Pick<LinkedVerdict, "chain">): LinkedVerdict => ({
  side: 1, decided: 1, confidence: 90, summary: "A won", evidenceHash: "0xabc", bundle: "{}", ...v,
});

test("pairKey: stable per draft and opener", () => {
  const d = { question: "Will BTC close above $100k?", deadline: 1_800_000_000, resolutionUrl: "https://x.test" };
  assert.equal(pairKeyOf("house", d), pairKeyOf("house", { ...d, question: "  will btc close above $100k?" }));
  assert.notEqual(pairKeyOf("house", d), pairKeyOf("agent:x", d));
  assert.match(pairKeyOf("house", d), /^house:[0-9a-f]{24}$/);
});

test("one decision per pair: the stored decision is reused by every leg, the deciding one included", () => {
  const stored = verdict({ chain: "base", stored: true, side: 2, decided: 2 });
  // The Arc leg reuses Base's stored decision.
  assert.equal(siblingDecision([stored], "arc"), stored);
  // The Base leg itself reuses it too (its proposal failed and is retried): no second model call.
  assert.equal(siblingDecision([stored], "base"), stored);
  // A proposed verdict on the leg's own chain is not a sibling's decision.
  assert.equal(siblingDecision([verdict({ chain: "base" })], "base"), null);
  // The stored decision wins over a proposed one.
  const proposed = verdict({ chain: "arc", side: 1, decided: 1 });
  assert.equal(siblingDecision([proposed, stored], "arc"), stored);
  // An uncontested refund decided nothing: never reused.
  assert.equal(siblingDecision([verdict({ chain: "base", side: 3, decided: undefined })], "arc"), null);
});

test("reused decision: the sibling's own late-stake override is dropped, the decided side is proposed", () => {
  const v = verdict({
    chain: "base",
    side: 4,
    decided: 2,
    summary: "late stakes, refunded",
    decidedSummary: "B won",
    bundle: JSON.stringify({ verdict: "CHALLENGERS_WIN", lateStakeRefund: { knownAt: 1 } }),
  });
  const r = reuseDecision(v);
  assert.equal(r.side, 2);
  assert.equal(r.summary, "B won");
  assert.equal(r.evidenceHash, null); // re-sealed by the oracle
  assert.deepEqual(JSON.parse(r.bundle), { verdict: "CHALLENGERS_WIN" });
  assert.equal(reuseDecision(verdict({ chain: "arc" })).evidenceHash, "0xabc");
});

test("shared backoff: a leg waits while another leg's decision is deferred, unless the pair is decided", () => {
  const now = 1_000_000;
  assert.equal(pairWaits([now + 60_000], now, false), true);
  assert.equal(pairWaits([now - 1], now, false), false);
  assert.equal(pairWaits([], now, false), false);
  assert.equal(pairWaits([now + 60_000], now, true), false);
});

test("legs: one group per pairKey in chain order, unlinked rows alone", () => {
  const rows = [
    { chain: "arc" as const, id: 1, pairKey: "house:1" },
    { chain: "base" as const, id: 2 },
    { chain: "base" as const, id: 3, pairKey: "house:1" },
    { chain: "arc" as const, id: 4, pairKey: "twin:base:pool:9" },
  ];
  const g = groupLegs(rows);
  assert.equal(g.length, 3);
  assert.deepEqual(g[0].legs.map((l) => l.id), [3, 1]); // Base first
  assert.equal(g[0].lead.id, 3);
  assert.deepEqual(g[1].legs.map((l) => l.id), [2]);
  assert.deepEqual(g[2].legs.map((l) => l.id), [4]);
  assert.deepEqual(missingChains(["base"], ["base", "arc"]), ["arc"]);
  assert.deepEqual(missingChains(["arc", "base"], ["base", "arc"]), []);
});

test("council: one take per linked pair, copied to a leg without one", () => {
  const legs = [{ chain: "base", id: 1 }, { chain: "arc", id: 2 }];
  // Nobody has a take: one call for the group (no source), written to both legs.
  assert.deepEqual(takeReuse(legs, () => false), { source: null, missing: legs });
  // Base has it: Arc gets a copy, no call.
  const r = takeReuse(legs, (l) => l.chain === "base");
  assert.equal(r.source, legs[0]);
  assert.deepEqual(r.missing, [legs[1]]);
  // Both have it: nothing to do.
  assert.deepEqual(takeReuse(legs, () => true).missing, []);
});
