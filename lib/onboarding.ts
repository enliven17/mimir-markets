/**
 * First-stake onboarding on Solana devnet: the five things a new visitor has
 * to do before they can put USDC behind a claim, each derived from state the
 * app already reads (wallet, SOL and USDC balances, the Mimir virtual balance
 * and its layer, the positions index).
 *
 * Nothing here is stored except the dismissal. A step is done because the
 * chain says so, not because somebody clicked "mark as done", so the list
 * cannot drift from reality.
 */
import { MIN_STAKE_UNITS } from "./solana/config";

export const ONBOARDING_STEP_IDS = ["connect", "sol", "usdc", "deposit", "stake"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

/** Enough SOL for a handful of transactions and account rent (0.01 SOL). */
export const MIN_SOL_LAMPORTS = 10_000_000n;

export const SOLANA_FAUCET_URL = "https://faucet.solana.com";
export const CIRCLE_FAUCET_URL = "https://faucet.circle.com";

export interface OnboardingInputs {
  isConnected: boolean;
  /** Wallet SOL in lamports; null while unknown. */
  lamports: bigint | null;
  /** USDC in the wallet's token account, base units; null while unknown. */
  usdcUnits: bigint | null;
  /** Mimir virtual balance, base units; null while unknown. */
  virtualUnits: bigint | null;
  /** Where the virtual balance lives; "er" once delegated to the rollup. */
  layer: "none" | "base" | "er" | null;
  /** Wallet holds any claim as creator or challenger; null while unknown. */
  hasStake: boolean | null;
}

export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
}

export function onboardingSteps(i: OnboardingInputs): OnboardingStep[] {
  // Every later step is about *this* wallet, so none can be done without one.
  const c = i.isConnected;
  const staked = c && i.hasStake === true;
  const inRollup = c && i.layer === "er" && i.virtualUnits !== null && i.virtualUnits >= MIN_STAKE_UNITS;
  // USDC already moved into the vault (or staked) still counts as "got USDC".
  const usdc = c && ((i.usdcUnits ?? 0n) + (i.virtualUnits ?? 0n) >= MIN_STAKE_UNITS || staked);
  return [
    { id: "connect", done: c },
    { id: "sol", done: c && i.lamports !== null && i.lamports >= MIN_SOL_LAMPORTS },
    { id: "usdc", done: usdc },
    // A creator stakes from the token account directly, so a first stake
    // also means the deposit step is behind them.
    { id: "deposit", done: inRollup || staked },
    { id: "stake", done: staked },
  ];
}

/** The first step still pending, or null when all are done. */
export function currentOnboardingStep(steps: OnboardingStep[]): OnboardingStepId | null {
  return steps.find((s) => !s.done)?.id ?? null;
}

export const ONBOARDING_DISMISS_KEY = "mimir:onboarding:dismissed";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari private mode and sandboxed iframes throw on access.
    return null;
  }
}

export function readOnboardingDismissed(storage: KeyValueStore | null = browserStorage()): boolean {
  try {
    return storage?.getItem(ONBOARDING_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeOnboardingDismissed(storage: KeyValueStore | null = browserStorage()): void {
  try {
    storage?.setItem(ONBOARDING_DISMISS_KEY, "1");
  } catch {
    // Quota or privacy mode: the dismissal just lasts for this page view.
  }
}
