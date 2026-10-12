import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGwei } from "viem";

import { userOpFees } from "../../lib/arc/account";

test("the tip never goes under 1 gwei (Arc mainnet bundler minimum); a higher suggestion is kept", () => {
  const base = parseGwei("48");
  assert.deepEqual(userOpFees(base, 2304n), { maxPriorityFeePerGas: parseGwei("1"), maxFeePerGas: base * 2n + parseGwei("1") });
  assert.equal(userOpFees(base, parseGwei("3")).maxPriorityFeePerGas, parseGwei("3"));
});

test("Circle's low quote (41.5 gwei cap, 1.5 gwei tip) passes through unchanged", () => {
  const f = userOpFees(parseGwei("40"), parseGwei("1.5"), 1n);
  assert.deepEqual(f, { maxPriorityFeePerGas: parseGwei("1.5"), maxFeePerGas: parseGwei("41.5") });
});
