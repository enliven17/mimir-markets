import { test } from "node:test";
import assert from "node:assert/strict";
import type { Condition } from "../../lib/launch/types";
import { checkRules, passes, passingCandidates } from "../../lib/launch/engine/rules";
import { cand, MINT_A, MINT_B } from "../../lib/launch/engine/fixtures";

const liq = (value: number, op: ">" | "<" = ">"): Condition => ({ metric: "liquidityUsd", op, value });

test("passes when every condition holds", () => {
  assert.equal(passes(cand(MINT_A), [liq(50_000), { metric: "volume1hUsd", op: ">", value: 1 }]), true);
});

test("strict comparison: equal value fails both > and <", () => {
  assert.equal(passes(cand(MINT_A), [liq(100_000)]), false);
  assert.equal(passes(cand(MINT_A), [liq(100_000, "<")]), false);
});

test("unknown metric never passes", () => {
  const bogus = { metric: "rugScore", op: ">", value: 0 } as unknown as Condition;
  const r = checkRules(cand(MINT_A), [bogus]);
  assert.equal(r.ok, false);
  assert.match(r.failed[0], /unknown metric/);
});

test("missing, NaN or Infinity metric values fail", () => {
  for (const v of [undefined, NaN, Infinity, "5" as unknown as number]) {
    assert.equal(passes(cand(MINT_A, { metrics: { liquidityUsd: v } }), [liq(1)]), false, String(v));
  }
});

test("bad operator or non-finite threshold fails", () => {
  assert.equal(passes(cand(MINT_A), [{ metric: "liquidityUsd", op: ">=" as never, value: 1 }]), false);
  assert.equal(passes(cand(MINT_A), [liq(NaN)]), false);
});

test("empty or missing rule set fails closed", () => {
  assert.equal(passes(cand(MINT_A), []), false);
  assert.equal(passes(cand(MINT_A), undefined as unknown as Condition[]), false);
});

test("< works and failure reasons are readable", () => {
  const r = checkRules(cand(MINT_A, { metrics: { ageMinutes: 30 } }), [{ metric: "ageMinutes", op: "<", value: 10 }]);
  assert.deepEqual(r, { ok: false, failed: ["ageMinutes 30 not < 10"] });
});

test("passingCandidates filters", () => {
  const out = passingCandidates([cand(MINT_A), cand(MINT_B, { metrics: { liquidityUsd: 10 } })], [liq(50_000)]);
  assert.deepEqual(out.map((c) => c.mint), [MINT_A]);
});
