/** GeckoTerminal adapter for the shared ShieldBot assessment on Pons. */
import type { SafetyFeed } from "../engine/shield";
import { createGeckoSafety, type GeckoFeedOptions } from "../market/gecko";

export type PonsShieldOptions = Omit<GeckoFeedOptions, "network">;

export function createPonsShield(opts: PonsShieldOptions = {}): SafetyFeed {
  return createGeckoSafety({ ...opts, network: "robinhood" });
}
