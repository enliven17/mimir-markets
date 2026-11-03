import test from "node:test";
import assert from "node:assert/strict";

import { confidenceTier, settlementPreview } from "../../lib/settlement-preview";

const base = { resolutionUrl: "https://example.com", category: "crypto", deadline: 1_800_000_000 };

test("the preview follows the oracle's decision order", () => {
  const spec = 'resolver: {"kind":"price","symbol":"BTC","op":">","threshold":100000}';
  assert.equal(settlementPreview({ ...base, question: "Will BTC close above $100k?", settlementRule: spec }).method, "resolver-price");
  assert.equal(
    settlementPreview({ ...base, question: "Will BTC close above $100k?", resolutionUrl: "https://flashapi.trade/prices/BTC#mimir=price:BTC:gt:100000" }).method,
    "resolver-price",
    "the spec rides in the resolution URL",
  );
  assert.equal(settlementPreview({ ...base, question: "Will BTC close above $100k?", settlementRule: "" }).method, "price-consensus");
  assert.equal(settlementPreview({ ...base, question: "Will the album top the charts?", category: "culture" }).method, "evidence-llm");
  assert.equal(settlementPreview({ ...base, question: "Who wins?", category: "sports" }).waitsForFinal, "sports");
  assert.equal(settlementPreview({ ...base, question: "x", resolutionUrl: "https://polymarket.com/event/x" }).waitsForFinal, "polymarket");
  assert.ok(settlementPreview({ ...base, question: "x", disputeWindow: 86_400 }).steps.some((s) => s.includes("1 day")));
});

test("the confidence tier reads what the oracle wrote on chain", () => {
  assert.equal(confidenceTier(1, 95, "[RESOLVER] BTC > 100000"), "deterministic");
  assert.equal(confidenceTier(1, 88, "clear evidence"), "firm");
  assert.equal(confidenceTier(2, 70, "[CONTESTED] [via-direct] ..."), "contested");
  assert.equal(confidenceTier(4, 40, "[LOW CONFIDENCE, refunded]"), "refunded");
  assert.equal(confidenceTier(3, 90, "tie"), "refunded");
});

test("the preview only promises specs the oracle honours", () => {
  assert.equal(
    settlementPreview({ ...base, question: "Did it happen?", resolutionUrl: "https://attacker.example/x.json#mimir=json:eq:true:won" }).method,
    "evidence-llm",
    "untrusted JSON host",
  );
  assert.equal(
    settlementPreview({ ...base, question: "Will SOL trade above $250?", resolutionUrl: "https://www.coingecko.com/en/coins/solana#mimir=price:SOL:lt:250" }).method,
    "price-consensus",
    "spec contradicts the question",
  );
});

test("trusted JSON metadata shows original-question evidence evaluation before staking", () => {
  const url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401234567";
  for (const metadata of [
    { resolutionUrl: `${url}#mimir=json:eq:true:header.competitions[0].status.type.completed` },
    { resolutionUrl: url, settlementRule: `resolver: ${JSON.stringify({ kind: "json", url, path: "header.competitions[0].status.type.completed", op: "==", value: true })}` },
  ]) {
    const preview = settlementPreview({ ...base, ...metadata, question: "Will the final combined score exceed 250?", category: "sports", disputeWindow: 3600 });
    assert.equal(preview.method, "evidence-llm");
    assert.equal(preview.waitsForFinal, "sports");
    assert.ok(preview.steps.some(step => step.includes("AI oracle judges the evidence against the claim")));
    assert.ok(preview.steps.some(step => step.includes("any participant can dispute")));
    assert.doesNotMatch(preview.steps.join("\n"), /No AI model|YES if it is/);
  }
});
