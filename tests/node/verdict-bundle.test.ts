import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { bundleHash, canonicalJson, sealBundle, VERDICT_BUNDLE_VERSION, type VerdictBundle } from "../../lib/verdict-bundle";

const bundle: VerdictBundle = {
  version: VERDICT_BUNDLE_VERSION,
  program: "EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE",
  claimId: 7,
  decidedAt: 1_800_000_000_000,
  claim: { question: "Will it?", creatorPosition: "Yes", counterPosition: "No", resolutionUrl: "https://x", category: "crypto", deadline: 1 },
  model: undefined,
  adjustments: ["price consensus: agree"],
  finalVerdict: { verdict: "CREATOR_WINS", confidence: 90, explanation: "because" },
};

test("the stored text re-hashes to the committed hash after a JSON round trip", () => {
  const { canonical, hash, bytes } = sealBundle(bundle);
  assert.equal(bundleHash(JSON.parse(canonical)), hash);
  assert.equal(bytes.length, 32, "fits the on-chain evidence_hash");
  assert.ok(!canonical.includes("model"), "undefined fields are not part of the hashed bytes");
});

test("the hash is plain sha256 of the file, checkable with sha256sum", () => {
  const { canonical, hash } = sealBundle(bundle);
  assert.equal(createHash("sha256").update(canonical, "utf8").digest("hex"), hash);
});

test("canonical form ignores key order but not content", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  const tampered = { ...bundle, finalVerdict: { ...bundle.finalVerdict, confidence: 91 } };
  assert.notEqual(bundleHash(tampered), bundleHash(bundle));
});
