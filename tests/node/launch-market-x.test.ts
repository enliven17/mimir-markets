import assert from "node:assert/strict";
import { test } from "node:test";

import { createXSource, parsePosts } from "../../lib/launch/market/x";
import { MINT_A, MINT_B } from "../../lib/launch/engine/fixtures";

const NOW = 1_791_217_500_000;

// ---------- x ----------
test("x: disabled without a bin; counts posts containing a mint in the last hour", async () => {
  assert.deepEqual(await createXSource({}).candidates({ whales: [] }), []);
  const posts = [
    { text: `ape ${MINT_A} now`, created_at: new Date(NOW - 5 * 60_000).toISOString() },
    { full_text: `${MINT_A} ${MINT_A} again`, createdAt: NOW - 10 * 60_000 },
    { text: `old ${MINT_B}`, created_at: new Date(NOW - 2 * 3600_000).toISOString() },
    { text: "no mint here" },
  ];
  let argv: string[] = [];
  const src = createXSource({ bin: "twitter", now: () => NOW, run: async (_b, a) => ((argv = a), JSON.stringify({ data: posts })) });
  const out = await src.candidates({ whales: [] });
  assert.deepEqual(out.map((c) => [c.mint, c.metrics.mentions1h]), [[MINT_A, 2]]);
  assert.deepEqual(argv.slice(-3), ["-n", "100", "--json"]);
});

test("x: CLI failure or junk output never throws", async () => {
  const errors: unknown[] = [];
  const failing = createXSource({ bin: "twitter", run: async () => { throw new Error("timeout"); }, onError: (_s, e) => errors.push(e) });
  assert.deepEqual(await failing.candidates({ whales: [] }), []);
  assert.equal(errors.length, 1);
  assert.deepEqual(parsePosts("not json"), []);
  assert.deepEqual(parsePosts(JSON.stringify({ weird: true })), []);
});
