import { test } from "node:test";
import assert from "node:assert/strict";
import { opinionSplit, signalMatches } from "../../lib/discovery";
import { seriesDraft, seriesForMarket, nextSeriesDeadline } from "../../lib/market-series";
import { strategyFingerprint } from "../../lib/launch/strategy-manifest";
import { settlementTimeline } from "../../lib/settlement-timeline";
test("council disagreements use each persona's latest explicit side, never abstention as a side", () => {
  assert.deepEqual(opinionSplit([{ slug: "a", lean: 1, at: 1 }, { slug: "a", lean: 2, at: 2 }, { slug: "b", at: 3 }, { slug: "c", lean: 1, at: 1 }]), { a: 1, b: 1, unknown: 1, disagreement: 1 });
  assert.equal(signalMatches("series:sol-daily", { marketKind: "pool", marketId: 1, category: "crypto" }, "sol-daily"), true);
  assert.equal(signalMatches("agent:a", { marketKind: "pool", marketId: 1, category: "crypto", slug: "b" }), false);
});
test("daily templates handle UTC rollovers and cannot label inconsistent rules as a series", () => {
  const now = Date.UTC(2026, 9, 26, 11, 55);
  assert.equal(nextSeriesDeadline(now), Date.UTC(2026, 9, 27, 12) / 1000);
  const draft = seriesDraft("sol-daily", 150, now)!;
  assert.equal(seriesForMarket(draft), "sol-daily");
  assert.equal(seriesForMarket({ ...draft, labelA: "No" }), null);
  assert.equal(seriesForMarket({ ...draft, deadline: draft.deadline + 60 }), null);
  assert.equal(seriesForMarket({ ...draft, question: draft.question.replace("150", "200") }), null);
  assert.equal(seriesDraft("sol-daily", NaN, now), null);
});
test("strategy fingerprints ignore key order and identify changed risk or model", () => {
  const a = { thesis: "a", chain: "solana", trading: { stopLoss: 10, sources: ["dex"] }, markets: {}, model: "m1" };
  assert.equal(strategyFingerprint(a), strategyFingerprint({ ...a, trading: { sources: ["dex"], stopLoss: 10 } }));
  assert.notEqual(strategyFingerprint(a), strategyFingerprint({ ...a, model: "m2" }));
});
test("settlement timeline uses actual proposal timestamps and exposes active disputes", () => {
  const m = { status: "disputed", createdAt: 1, deadline: 1000, lockAt: 800, disputableUntil: 2000, refundAt: 3000 };
  const timeline = settlementTimeline(m, [{ name: "ResolutionProposed", at: 1100 }, { name: "ResolutionDisputed", at: 1200 }], 1300);
  assert.equal(timeline[1].at, 800); assert.equal(timeline[3].at, 1100); assert.equal(timeline[4].state, "active"); assert.equal(timeline[5].at, null);
});
