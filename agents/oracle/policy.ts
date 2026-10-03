/**
 * The oracle worker's safety switches, parsed strictly. Pure (env and cluster
 * are passed in) so every branch is tested without starting the worker.
 */

export type HedgeMode = "dry" | "live" | "off";

/**
 * HEDGE_MODE: only "dry", "live" or "off" (trimmed, any case). Anything else
 * throws at startup instead of quietly meaning "live". Unset: "off" on
 * mainnet, "dry" elsewhere. Live signs real perp positions that nothing ever
 * closes, so it also needs HEDGE_ALLOW_UNMANAGED=1.
 */
export function parseHedgeMode(raw: string | undefined, opts: { mainnet: boolean; allowUnmanaged: boolean }): HedgeMode {
  const v = raw?.trim().toLowerCase() ?? "";
  if (!v) return opts.mainnet ? "off" : "dry";
  if (v !== "dry" && v !== "live" && v !== "off") {
    throw new Error(`HEDGE_MODE must be dry, live or off (got ${JSON.stringify(raw)})`);
  }
  if (v === "live" && !opts.allowUnmanaged) {
    throw new Error("HEDGE_MODE=live opens perp positions the oracle never closes; set HEDGE_ALLOW_UNMANAGED=1 to accept that");
  }
  return v;
}

/**
 * Auto-challenge puts the settling oracle on one side of claims it judges.
 * On mainnet it stays off unless AUTO_CHALLENGE_MAINNET=1 says otherwise.
 */
export function autoChallengeEnabled(opts: { requested: boolean; mainnet: boolean; mainnetOverride: boolean }): boolean {
  return opts.requested && (!opts.mainnet || opts.mainnetOverride);
}

/**
 * Per-claim exponential backoff for claims that are not ready to settle (no
 * final result yet, no evidence, model unavailable): 5 min, doubling, capped
 * at 1 h, so a claim that never resolves does not cost an LLM call per poll.
 */
export class ClaimBackoff {
  private readonly state = new Map<string, { attempts: number; until: number }>();

  constructor(
    private readonly baseMs = 5 * 60_000,
    private readonly maxMs = 60 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  ready(key: string): boolean {
    return (this.state.get(key)?.until ?? 0) <= this.now();
  }

  /** Push the claim back; returns the delay applied. */
  defer(key: string): number {
    const attempts = (this.state.get(key)?.attempts ?? 0) + 1;
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** (attempts - 1));
    this.state.set(key, { attempts, until: this.now() + delay });
    return delay;
  }

  clear(key: string): void {
    this.state.delete(key);
  }
}
