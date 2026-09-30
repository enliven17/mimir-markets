import test from "node:test";
import assert from "node:assert/strict";

import { parseVerdict } from "../../agents/oracle/evaluate";
import { applyFetcherTrust, applyPriceConsensus, tierVerdict } from "../../agents/oracle/decide";

test("a verdict parses out of chatty output, and prose does not", () => {
  assert.deepEqual(parseVerdict('Sure: {"verdict":"CREATOR_WINS","confidence":91.6,"explanation":"x"} ok'), {
    verdict: "CREATOR_WINS",
    confidence: 92,
    explanation: "x",
  });
  assert.equal(parseVerdict("- Side A looks right\n- confidence high"), null);
  assert.equal(parseVerdict('{"verdict":"MAYBE","confidence":50}'), null);
});

test("confidence tiers settle, mark contested, or refund", () => {
  const v = (confidence: number) => ({ verdict: "CHALLENGERS_WIN" as const, confidence, explanation: "e" });
  assert.equal(tierVerdict(v(85)).explanation, "e");
  assert.match(tierVerdict(v(70)).explanation, /^\[CONTESTED\]/);
  assert.equal(tierVerdict(v(40)).verdict, "UNRESOLVABLE");
  assert.equal(applyFetcherTrust(v(95), "jina").confidence, 75, "scraped evidence is capped below FIRM");
  assert.equal(applyFetcherTrust(v(95), "flashtrade-api").confidence, 95);
});

test("price consensus refunds a model that contradicts two agreeing sources", () => {
  const deadline = 1_800_000_000;
  const claim = {
    question: "Will BTC trade above $100,000 at the deadline?",
    creatorPosition: "Yes: above",
    counterPosition: "No: not above",
    deadline,
  };
  const prices = {
    symbol: "BTC",
    threshold: 100_000,
    readings: [
      { source: "coingecko" as const, priceUsd: 101_000, at: deadline * 1000 },
      { source: "chainlink" as const, priceUsd: 101_200, at: deadline * 1000 },
    ],
  };
  const wrong = applyPriceConsensus(claim, { verdict: "CHALLENGERS_WIN", confidence: 90, explanation: "" }, prices);
  assert.equal(wrong.verdict.verdict, "UNRESOLVABLE");
  const right = applyPriceConsensus(claim, { verdict: "CREATOR_WINS", confidence: 80, explanation: "" }, prices);
  assert.equal(right.verdict.verdict, "CREATOR_WINS");
  assert.ok(right.verdict.confidence > 80, "agreement boosts only the side the data backs");
});
