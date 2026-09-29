import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanCandidate,
  gatherCouncilPreflight,
  parsePreflight,
  preflightKeeps,
  preflightPersonas,
  preflightPrompt,
  summarizePreflight,
  MAX_PREFLIGHT_PERSONAS,
} from "../../agents/market-creator/council-preflight";
import { getPersonaBySlug } from "../../agents/council/personas";

const draft = {
  question: "Will SOL close above $200 on Friday?",
  creatorPosition: "Yes",
  counterPosition: "No",
  resolutionUrl: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
  category: "Crypto",
  deadlineHours: 48,
};

test("candidates need a question, both sides and a source", () => {
  assert.equal(cleanCandidate(null), null);
  assert.equal(cleanCandidate({ ...draft, counterPosition: " " }), null);
  assert.equal(cleanCandidate({ ...draft, question: "short" }), null);
  const c = cleanCandidate({ ...draft, deadlineHours: "-4", question: "x".repeat(900) })!;
  assert.equal(c.question.length, 500);
  assert.equal(c.category, "crypto");
  assert.equal(c.deadlineHours, 0);
  assert.equal(c.settlementRule, "");
});

test("persona selection keeps known slugs, caps the panel and falls back to the defaults", () => {
  assert.deepEqual(preflightPersonas(undefined).map((p) => p.slug), ["statistician", "socrates", "aurelius"]);
  assert.deepEqual(preflightPersonas(["nobody"]).map((p) => p.slug), ["statistician", "socrates", "aurelius"]);
  assert.deepEqual(preflightPersonas("kahneman, taleb").map((p) => p.slug), ["kahneman", "taleb"]);
  assert.equal(preflightPersonas(["optimist", "pessimist", "doomer", "yapper", "socrates", "taleb", "ada"]).length, MAX_PREFLIGHT_PERSONAS);
});

test("replies parse strictly and clamp", () => {
  assert.equal(parsePreflight("looks fine"), null);
  assert.equal(parsePreflight('{"decision":"maybe"}'), null);
  assert.deepEqual(parsePreflight('{"decision":"OPEN","score":130,"confidence":-5,"reasoning":"clear"}'), {
    decision: "open",
    score: 100,
    confidence: 0,
    reasoning: "clear",
  });
});

test("the prompt fences the candidate", () => {
  const p = preflightPrompt(getPersonaBySlug("socrates")!, cleanCandidate(draft)!);
  assert.match(p, /<untrusted label="candidate">/);
  assert.match(p, /48 hours from now/);
});

test("a specialist outside its domain skips without an LLM call, and errors abstain", async () => {
  let calls = 0;
  const result = await gatherCouncilPreflight({
    candidate: cleanCandidate({ ...draft, category: "weather" })!,
    personas: [getPersonaBySlug("crypto-maxi")!, getPersonaBySlug("socrates")!, getPersonaBySlug("ada")!],
    llm: async () => {
      calls++;
      if (calls === 2) throw new Error("429");
      return '{"decision":"revise","score":55,"confidence":60,"reasoning":"rule is vague"}';
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.opinions.length, 2);
  assert.equal(result.opinions[0].slug, "crypto-maxi");
  assert.equal(result.skipVotes, 1);
  assert.equal(result.reviseVotes, 1);
});

test("the market-creator keeps a draft unless the council scores it low or mostly skips", () => {
  const op = (decision: "open" | "revise" | "skip", score: number) => ({
    slug: "s", displayName: "S", emoji: "", decision, score, confidence: 50, reasoning: "",
  });
  assert.equal(preflightKeeps(summarizePreflight([]), 60), true);
  assert.equal(preflightKeeps(summarizePreflight([op("open", 80), op("revise", 60)]), 60), true);
  assert.equal(preflightKeeps(summarizePreflight([op("open", 50), op("open", 60)]), 60), false);
  assert.equal(preflightKeeps(summarizePreflight([op("skip", 90), op("skip", 90), op("open", 90)]), 60), false);
});
