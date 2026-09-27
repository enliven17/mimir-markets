/**
 * Runtime pause switches and feature flags.
 *
 * Pausing is per capability, set with `MIMIR_PAUSE_<CAPABILITY>=1`, so an
 * incident can close one surface without taking the product down. Reading
 * markets and withdrawing money are deliberately not pausable: whatever else
 * breaks, a user must always be able to see state and get their money out.
 *
 * These are off-chain switches: they stop our own workers and API routes from
 * signing, they do not (and cannot) pause the Mimir program itself.
 */

export const PAUSABLE = [
  "create_market",
  "stake",
  "copy_execution",
  "oracle_settlement",
  "auto_challenge",
  "market_creator_worker",
  "council_worker",
] as const;

export const NEVER_PAUSABLE = ["withdraw", "read_markets", "read_reasoning"] as const;

export type Pausable = (typeof PAUSABLE)[number];

export const FEATURES = [
  "copy_trading",
  "source_drafts",
  "council_settlement",
  "auto_challenge",
] as const;

export type Feature = (typeof FEATURES)[number];

function envTrue(key: string): boolean {
  const v = process.env[key]?.trim();
  return v === "1" || v?.toLowerCase() === "true";
}

export function isPaused(capability: Pausable): boolean {
  return envTrue(`MIMIR_PAUSE_${capability.toUpperCase()}`);
}

export function pausedCapabilities(): Pausable[] {
  return PAUSABLE.filter(isPaused);
}

/**
 * Throws when the capability is paused. Call at the top of any code path that
 * moves money, so a pause takes effect before a signature is produced.
 */
export function assertNotPaused(capability: Pausable): void {
  if (isPaused(capability)) {
    throw new Error(`capability_paused:${capability}`);
  }
}

/**
 * Which pause switch guards a Mimir program instruction (IDL names). Cancelling
 * your own open claim, payouts and withdrawing get money out, so nothing
 * pauses them.
 */
export function capabilityForInstruction(instruction: string): Pausable | null {
  switch (instruction) {
    case "create_claim":
      return "create_market";
    case "challenge_claim":
      return "stake";
    case "resolve_claim":
      return "oracle_settlement";
    default:
      return null;
  }
}

/** Worker-level switches: a paused worker skips its whole cycle. */
export function capabilityForWorker(worker: string): Pausable | null {
  if (worker === "market_creator") return "market_creator_worker";
  if (worker === "council") return "council_worker";
  return null;
}

export function isFeatureEnabled(feature: Feature): boolean {
  return envTrue(`MIMIR_FEATURE_${feature.toUpperCase()}`);
}
