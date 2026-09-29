import assert from "node:assert/strict";
import test from "node:test";

import { tallyCouncil, type TallyClaim } from "../../lib/council-tally";

const claim = (id: number, state: number, winnerSide: number, challengers: [string, number][]): TallyClaim => ({
  id,
  question: `q${id}`,
  state,
  winnerSide,
  challengers: challengers.map(([addr, usdc]) => ({ addr, stake: BigInt(usdc * 1e6) })),
});

test("tallies count stakes, record and only unsettled stake as at risk", () => {
  const claims = [
    claim(5, 1, 0, [["A", 2], ["X", 9]]), // active
    claim(4, 4, 2, [["A", 3]]), // proposed: still at risk, not yet a win
    claim(3, 2, 2, [["A", 2], ["B", 2]]), // challengers won
    claim(2, 2, 1, [["B", 4]]), // creator won
    claim(1, 3, 0, [["A", 5]]), // cancelled
  ];
  const t = tallyCouncil(["A", "B", ""], claims);
  const a = t.get("A")!;
  assert.equal(a.stakes, 4);
  assert.equal(a.staked, 12_000_000n);
  assert.equal(a.atRisk, 5_000_000n);
  assert.equal(a.won, 1);
  assert.equal(a.lost, 0);
  assert.deepEqual(a.recentBets.map((b) => b.claimId), [5, 4, 3]);
  const b = t.get("B")!;
  assert.equal(b.won, 1);
  assert.equal(b.lost, 1);
  assert.equal(b.atRisk, 0n);
  assert.equal(t.has("X"), false, "non-council challengers are ignored");
  assert.equal(t.has(""), false, "an unknown address is not a key");
});
