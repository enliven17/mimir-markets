import assert from "node:assert/strict";
import { test } from "node:test";

import { proposalProblem, roleProblems } from "../../lib/arc/watch";

const SAFE = "0x5b3cd4d9e2ab1cc1317bd274aa19ed92d60e12c1";
const ORACLE = "0x651216ed682cdaa06efaac332aad7a7bc9f4f7c4";
const ZERO = "0x0000000000000000000000000000000000000000";
const healthy = { name: "MimirV3", address: "0xv3", owner: SAFE, paused: false, oracle: ORACLE, arbiter: SAFE, feeRecipient: SAFE, pending: { owner: ZERO, oracle: ZERO } };

test("a healthy contract raises nothing; case does not matter", () => {
  assert.deepEqual(roleProblems({ ...healthy, oracle: ORACLE.toUpperCase().replace("0X", "0x") }, ORACLE), []);
});

test("pause, a foreign oracle, a split arbiter and a queued change are each reported", () => {
  const keys = roleProblems({ ...healthy, paused: true, oracle: "0xbad", arbiter: "0xother", pending: { owner: "0xthief" } }, ORACLE).map((p) => p.key.split(":")[0]);
  assert.deepEqual(keys, ["paused", "oracle", "arbiter", "pending"]);
});

test("a proposal matching our verdict is fine; a different or unknown one is an anomaly", () => {
  const p = { kind: "pool", marketId: 7, question: "Q", disputableUntil: 1_800_000_000, verdictSide: 1 };
  assert.equal(proposalProblem(p, 1), null);
  assert.match(proposalProblem(p, 2)!.text, /ORACLE ANOMALY/);
  assert.match(proposalProblem({ ...p, verdictSide: null }, 1)!.text, /recorded nothing/);
});
