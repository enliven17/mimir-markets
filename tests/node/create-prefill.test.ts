import assert from "node:assert/strict";
import test from "node:test";

import { createPrefillHref, parseCreatePrefill } from "../../lib/create-prefill";
import type { SourceClaimDraftCandidate } from "../../lib/claimDrafts";

const NOW = Date.parse("2026-09-01T00:00:00Z") / 1000;

const candidate: SourceClaimDraftCandidate = {
  category: "crypto",
  claimText: "Will BTC trade above $100,000 before Dec 31, 2026?",
  sideA: "BTC trades above $100,000",
  sideB: "BTC stays at or below $100,000",
  deadlineAt: "2026-12-31T23:59:00.000Z",
  timezone: "UTC",
  primaryResolutionSource: "https://coinmarketcap.com/currencies/bitcoin/",
  settlementRule: "Resolve from the linked page at the deadline.",
  ambiguityFlags: [],
  confidenceScore: 80,
};

test("a card href round-trips into a full prefill", () => {
  const href = createPrefillHref(candidate);
  assert.ok(href.startsWith("/arena/create?source="));
  const prefill = parseCreatePrefill(new URL(href, "http://x").searchParams, NOW);
  assert.deepEqual(prefill, {
    source: candidate.primaryResolutionSource,
    question: candidate.claimText,
    creatorPosition: candidate.sideA,
    counterPosition: candidate.sideB,
    category: "crypto",
    deadline: Date.parse(candidate.deadlineAt) / 1000 - 0,
    settlementRule: candidate.settlementRule,
  });
});

test("a bare source link still prefills the resolution url", () => {
  const prefill = parseCreatePrefill(new URLSearchParams({ source: "https://example.com/a" }), NOW);
  assert.equal(prefill?.source, "https://example.com/a");
  assert.equal(prefill?.question, "");
  assert.equal(prefill?.category, null);
});

test("malformed or oversized values are dropped, not truncated", () => {
  const prefill = parseCreatePrefill(
    new URLSearchParams({
      source: "javascript:alert(1)",
      q: "x".repeat(201),
      a: "ok side",
      cat: "nonsense",
      deadline: "2020-01-01T00:00:00Z",
    }),
    NOW,
  );
  // Neither a usable source nor a question: nothing to fill.
  assert.equal(prefill, null);

  const partial = parseCreatePrefill(
    new URLSearchParams({ q: "Will it rain in Paris tomorrow?", cat: "nonsense", deadline: "not a date" }),
    NOW,
  );
  assert.equal(partial?.source, "");
  assert.equal(partial?.category, "custom");
  assert.equal(partial?.deadline, null);
});
