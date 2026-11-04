/** Deposit timestamps are enforced by the contracts; event witnesses are explanatory only. */
export function settlementCutoff(knownAt: number | null, now: number): number {
  if (knownAt === null) return 0;
  if (!Number.isSafeInteger(knownAt) || knownAt <= 0 || knownAt > now) throw Error("Invalid settlement cutoff");
  return knownAt;
}

export type StakeTime = { at: number; user?: string };

/** The stakes at or after `knownAt` (unix seconds); none when the moment is unknown. */
export function lateStakes(knownAt: number | null, stakes: readonly StakeTime[]): StakeTime[] {
  if (knownAt === null || !Number.isFinite(knownAt)) return [];
  return stakes.filter((s) => s.at >= knownAt);
}

export function lateStakeSummary(knownAt: number, late: readonly StakeTime[], witnessesOnly = false): string {
  const when = new Date(knownAt * 1000).toISOString().slice(0, 16).replace("T", " ");
  return `Late deposits refunded: ${witnessesOnly ? "at least " : ""}${late.length} stake${late.length === 1 ? "" : "s"} came in after the outcome was known (${when} UTC). Only those deposits are returned (entry fees remain charged). Earlier stakes settle on the result.`;
}


/** Aggregated positions cannot identify which deposit portion was late. Keep UI outcome labels honest. */
export function settlementFunding(m: { settlementCutoff?: number; stakeA: string; stakeB: string; eligibleA?: string; eligibleB?: string }): "all" | "partial" | "refund" {
  if (!m.settlementCutoff || m.eligibleA === undefined || m.eligibleB === undefined) return "all";
  const a = BigInt(m.eligibleA), b = BigInt(m.eligibleB);
  if (a === 0n || b === 0n) return "refund";
  return a === BigInt(m.stakeA) && b === BigInt(m.stakeB) ? "all" : "partial";
}
