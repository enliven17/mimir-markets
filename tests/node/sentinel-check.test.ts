import test from "node:test";
import assert from "node:assert/strict";

import { auditProposal, type Proposal } from "../../agents/sentinel/check";
import { bundleHash, hashHex, sha256Bytes, type VerdictBundle } from "../../lib/verdict-bundle";

const claim = { question: "Will BTC be above $100,000?", creatorPosition: "Yes", counterPosition: "No", resolutionUrl: "https://x", category: "crypto", deadline: 1_800_000_000 };
const bundle: VerdictBundle = {
  version: 2, program: "bsc:0xabc", claimId: 1, decidedAt: 1, claim,
  evidence: { fetcher: "coingecko-api", text: "BTC 101000", sha256: hashHex(sha256Bytes("BTC 101000")) },
  prices: { symbol: "BTC", threshold: 100_000, readings: [] },
  adjustments: [], finalVerdict: { verdict: "CREATOR_WINS", confidence: 90, explanation: "above" },
};
const proposal: Proposal = { ...claim, side: 1, evidenceHash: "0x" + bundleHash(bundle) };
const at = claim.deadline * 1000;

test("an honest proposal has no faults", () => {
  assert.deepEqual(auditProposal(proposal, bundle, [{ source: "coingecko", priceUsd: 101_000, at }, { source: "pyth", priceUsd: 101_200, at }]), []);
});

test("each kind of tampering is caught", () => {
  assert.equal(auditProposal(proposal, null).length, 1);
  assert.match(auditProposal({ ...proposal, side: 2 }, bundle).join(), /judge decided/);
  assert.match(auditProposal({ ...proposal, evidenceHash: "0x" + "0".repeat(64) }, bundle).join(), /re-hash/);
  const swapped = { ...bundle, evidence: { ...bundle.evidence!, text: "BTC 99000" } };
  assert.match(auditProposal({ ...proposal, evidenceHash: "0x" + bundleHash(swapped) }, swapped).join(), /receipt/);
  assert.match(auditProposal({ ...proposal, question: "other" }, bundle).join(), /spec step/);
  const low = [{ source: "coingecko" as const, priceUsd: 98_000, at }, { source: "pyth" as const, priceUsd: 98_100, at }];
  assert.match(auditProposal(proposal, bundle, low).join(), /independent deadline prices say CHALLENGERS_WIN/);
});
