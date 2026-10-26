import { test } from "node:test";
import assert from "node:assert/strict";
import { opinionSplit, signalMatches } from "../../lib/discovery";
import { seriesDraft, seriesForMarket, nextSeriesDeadline } from "../../lib/market-series";
import { verifiedPoolSavings, previewBenefits } from "../../lib/token-benefits";
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
test("fee savings pair an entry's actual fee and stake and skip ambiguous or other-user segments", () => {
  const events = [
    { name: "FeeAccrued", txHash: "a", logIndex: 1, amount: "25" }, { name: "Staked", txHash: "a", logIndex: 2, amount: "9975", user: "alice", at: 100 },
    { name: "FeeAccrued", txHash: "a", logIndex: 3, amount: "50" }, { name: "Staked", txHash: "a", logIndex: 4, amount: "9950", user: "bob", at: 100 },
    { name: "Staked", txHash: "old", logIndex: 1, amount: "10000", user: "alice" },
  ];
  assert.deepEqual(verifiedPoolSavings(events, "alice", 50), { entries: 1, gross: "10000", paid: "25", saved: "25" });
  assert.equal(verifiedPoolSavings(events, "alice", 101).entries, 0);
  assert.equal(previewBenefits("oracle-circle").aiCallsPerAgentDay, 12);
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
