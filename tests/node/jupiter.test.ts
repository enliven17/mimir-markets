import test from "node:test";
import assert from "node:assert/strict";

import { sellAmount, swapWarnings } from "../../lib/jupiter";

test("sell <pct> sells that share of the raw balance, never more", () => {
  assert.equal(sellAmount(1_000_000n, 50), 500_000n);
  assert.equal(sellAmount(1_000_000n, 100), 1_000_000n);
  assert.equal(sellAmount(1_000_000n, 250), 1_000_000n, "capped at 100%");
  assert.equal(sellAmount(1_000_000n, 33.33), 333_300n);
  assert.equal(sellAmount(0n, 50), 0n);
  assert.equal(sellAmount(1000n, 0), 0n);
});

test("a swap warns about impact and the token's red flags, and stays quiet for a clean one", () => {
  const clean = { verified: true, mintAuthorityDisabled: true, freezeAuthorityDisabled: true, liquidityUsd: 2_000_000 };
  assert.deepEqual(swapWarnings({ priceImpactPct: "-0.004" }, clean), []);
  const w = swapWarnings({ priceImpactPct: "-0.12" }, { verified: null, mintAuthorityDisabled: false, freezeAuthorityDisabled: false, liquidityUsd: 4_000 });
  assert.equal(w.length, 5);
  assert.match(w[0], /price impact 12\.0%/);
  assert.ok(w.some((x) => /not verified/.test(x)));
  assert.ok(w.some((x) => /mint more/.test(x)));
  assert.ok(w.some((x) => /freeze/.test(x)));
  assert.ok(w.some((x) => /thin liquidity \(\$4,000\)/.test(x)));
});
