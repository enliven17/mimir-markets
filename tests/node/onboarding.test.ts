import test from "node:test";
import assert from "node:assert/strict";

import {
  ONBOARDING_DISMISS_KEY,
  currentOnboardingStep,
  onboardingSteps,
  readOnboardingDismissed,
  writeOnboardingDismissed,
  type OnboardingInputs,
} from "../../lib/onboarding";

const USDC = (n: number) => BigInt(n * 1_000_000);
const SOL = (n: number) => BigInt(Math.round(n * 1e9));

const fresh: OnboardingInputs = {
  isConnected: true,
  lamports: 0n,
  usdcUnits: 0n,
  virtualUnits: 0n,
  layer: "none",
  hasStake: false,
};
const done = (i: OnboardingInputs) => onboardingSteps(i).filter((s) => s.done).map((s) => s.id);

test("a disconnected visitor has every step pending", () => {
  assert.deepEqual(
    done({ isConnected: false, lamports: SOL(5), usdcUnits: USDC(50), virtualUnits: USDC(50), layer: "er", hasStake: true }),
    [],
  );
});

test("steps are detected independently once connected", () => {
  assert.deepEqual(done(fresh), ["connect"]);
  assert.deepEqual(done({ ...fresh, lamports: SOL(1) }), ["connect", "sol"]);
  assert.deepEqual(done({ ...fresh, usdcUnits: USDC(20) }), ["connect", "usdc"]);
  assert.deepEqual(done({ ...fresh, lamports: SOL(1), virtualUnits: USDC(20), layer: "er" }), ["connect", "sol", "usdc", "deposit"]);
});

test("a deposit only counts once it is delegated to the rollup and covers the minimum stake", () => {
  assert.ok(!done({ ...fresh, virtualUnits: USDC(20), layer: "base" }).includes("deposit"));
  assert.ok(!done({ ...fresh, virtualUnits: USDC(1), layer: "er" }).includes("deposit"));
  assert.ok(!done({ ...fresh, virtualUnits: null, layer: "er" }).includes("deposit"));
});

test("funding thresholds and unknown balances stay pending", () => {
  assert.ok(!done({ ...fresh, usdcUnits: USDC(1.99) }).includes("usdc"));
  assert.ok(done({ ...fresh, usdcUnits: USDC(1), virtualUnits: USDC(1) }).includes("usdc"));
  assert.ok(!done({ ...fresh, lamports: SOL(0.009) }).includes("sol"));
  assert.ok(!done({ ...fresh, lamports: null }).includes("sol"));
});

test("a first stake closes the funding steps it needed, but not SOL", () => {
  assert.deepEqual(done({ ...fresh, hasStake: true }), ["connect", "usdc", "deposit", "stake"]);
});

test("the current step is the first pending one", () => {
  assert.equal(currentOnboardingStep(onboardingSteps({ ...fresh, usdcUnits: USDC(10) })), "sol");
  const all = onboardingSteps({ ...fresh, lamports: SOL(1), hasStake: true });
  assert.equal(currentOnboardingStep(all), null);
});

test("dismissal round-trips through storage and survives a throwing store", () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  assert.equal(readOnboardingDismissed(store), false);
  writeOnboardingDismissed(store);
  assert.equal(map.get(ONBOARDING_DISMISS_KEY), "1");
  assert.equal(readOnboardingDismissed(store), true);

  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(readOnboardingDismissed(broken), false);
  assert.doesNotThrow(() => writeOnboardingDismissed(broken));
  assert.equal(readOnboardingDismissed(null), false);
});
