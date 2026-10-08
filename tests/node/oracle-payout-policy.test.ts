import test from "node:test";
import assert from "node:assert/strict";

import { applyPayoutPolicy, hostAllowed, payoutPolicy } from "../../lib/oracle-payout-policy";
import { sealBundle, type VerdictBundle } from "../../lib/verdict-bundle";

const bundle = (resolutionUrl: string, extra: Partial<VerdictBundle> = {}): VerdictBundle => ({
  version: 1,
  program: "arc",
  claimId: 1,
  decidedAt: 1,
  claim: { question: "q", creatorPosition: "a", counterPosition: "b", resolutionUrl, category: "x", deadline: 1 },
  adjustments: [],
  finalVerdict: { verdict: "CREATOR_WINS", confidence: 85, explanation: "e" },
  ...extra,
});
const win = (confidence = 85) => ({ verdict: "CREATOR_WINS" as const, confidence, explanation: "because" });

test("allowlisted hosts and their subdomains, https only", () => {
  assert.ok(hostAllowed("https://api.coingecko.com/api/v3/simple/price"));
  assert.ok(hostAllowed("https://site.api.espn.com/apis/site/v2/sports"));
  assert.ok(!hostAllowed("https://evilcoingecko.com/x"));
  assert.ok(!hostAllowed("http://coingecko.com/x"));
  assert.ok(!hostAllowed("https://my-blog.example/result"));
  assert.ok(hostAllowed("https://my-blog.example/result", ["my-blog.example"]));
});

test("deterministic rules and two price feeds pay", () => {
  assert.equal(payoutPolicy({ verdict: win(), bundle: bundle("https://x.example", { resolver: { spec: {}, detail: "" } }) }).pay, true);
  const prices = { symbol: "BTC", threshold: 1, readings: [{ source: "pyth", priceUsd: 2, at: 1 }, { source: "coingecko", priceUsd: 2, at: 1 }] };
  assert.equal(payoutPolicy({ verdict: win(), bundle: bundle("https://x.example", { prices }) }).pay, true);
});

test("an unlisted page pays only at ≥90 with a council majority", () => {
  const votes = [
    { slug: "a", verdict: "CREATOR_WINS", confidence: 90 },
    { slug: "b", verdict: "CREATOR_WINS", confidence: 90 },
    { slug: "c", verdict: "DRAW", confidence: 60 },
  ];
  assert.equal(payoutPolicy({ verdict: win(85), bundle: bundle("https://x.example") }).pay, false);
  assert.equal(payoutPolicy({ verdict: win(95), bundle: bundle("https://x.example") }).pay, false);
  assert.equal(payoutPolicy({ verdict: win(95), bundle: bundle("https://x.example", { council: { tally: {}, votes } }) }).pay, true);
  assert.equal(payoutPolicy({ verdict: win(85), bundle: bundle("https://x.example", { council: { tally: {}, votes } }) }).pay, false);
});

test("on mainnet a refused payout becomes UNRESOLVABLE with a re-sealed bundle; off mainnet nothing changes", () => {
  const b = bundle("https://x.example");
  const decision = { verdict: win(85), bundle: b, evidenceHash: sealBundle(b).bytes };
  const off = applyPayoutPolicy(decision, false);
  assert.equal(off.verdict.verdict, "CREATOR_WINS");
  const on = applyPayoutPolicy(decision, true);
  assert.equal(on.verdict.verdict, "UNRESOLVABLE");
  assert.equal(on.bundle.finalVerdict.verdict, "UNRESOLVABLE");
  assert.deepEqual(on.evidenceHash, sealBundle(on.bundle).bytes);
  assert.match(on.bundle.adjustments.at(-1) ?? "", /mainnet payout policy/);
});
