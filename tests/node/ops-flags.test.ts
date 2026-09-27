import test from "node:test";
import assert from "node:assert/strict";

import {
  isPaused,
  assertNotPaused,
  pausedCapabilities,
  PAUSABLE,
  NEVER_PAUSABLE,
} from "../../lib/ops/flags";

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

test("a capability is paused only when explicitly switched on", () => {
  withEnv("MIMIR_PAUSE_STAKE", undefined, () => assert.equal(isPaused("stake"), false));
  withEnv("MIMIR_PAUSE_STAKE", "0", () => assert.equal(isPaused("stake"), false));
  withEnv("MIMIR_PAUSE_STAKE", "1", () => assert.equal(isPaused("stake"), true));
  withEnv("MIMIR_PAUSE_STAKE", "true", () => assert.equal(isPaused("stake"), true));
});

test("assertNotPaused throws with the capability name", () => {
  withEnv("MIMIR_PAUSE_CREATE_MARKET", "1", () => {
    assert.throws(() => assertNotPaused("create_market"), /capability_paused:create_market/);
  });
  withEnv("MIMIR_PAUSE_CREATE_MARKET", undefined, () => {
    assert.doesNotThrow(() => assertNotPaused("create_market"));
  });
});

test("pausedCapabilities lists only what is switched on", () => {
  withEnv("MIMIR_PAUSE_AUTO_CHALLENGE", "1", () => {
    assert.deepEqual(pausedCapabilities(), ["auto_challenge"]);
  });
});

test("withdrawing and reading are never pausable", () => {
  for (const cap of NEVER_PAUSABLE) {
    assert.equal((PAUSABLE as readonly string[]).includes(cap), false);
  }
});

test("program instructions map to the pause switch that guards them", async () => {
  const { capabilityForInstruction, capabilityForWorker } = await import("../../lib/ops/flags");
  assert.equal(capabilityForInstruction("create_claim"), "create_market");
  assert.equal(capabilityForInstruction("challenge_claim"), "stake");
  assert.equal(capabilityForInstruction("resolve_claim"), "oracle_settlement");
  for (const exit of ["withdraw", "cancel_claim", "payout_creator", "payout_challenger", "deposit"]) {
    assert.equal(capabilityForInstruction(exit), null, exit);
  }
  assert.equal(capabilityForWorker("council"), "council_worker");
  assert.equal(capabilityForWorker("market_creator"), "market_creator_worker");
  assert.equal(capabilityForWorker("oracle"), null);
});

test("feature flags read MIMIR_FEATURE_<NAME>", async () => {
  const { isFeatureEnabled } = await import("../../lib/ops/flags");
  withEnv("MIMIR_FEATURE_AUTO_CHALLENGE", "1", () => assert.equal(isFeatureEnabled("auto_challenge"), true));
  withEnv("MIMIR_FEATURE_AUTO_CHALLENGE", undefined, () => assert.equal(isFeatureEnabled("auto_challenge"), false));
});
