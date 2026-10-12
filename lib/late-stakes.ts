/**
 * Late stakes: money that went in after the outcome was already known (a match that had started, a "by date" event
 * that had happened). A market with any is refunded, not settled, so a deadline set after the event never pays
 * whoever bet with the answer in hand. The oracle asks a model when the outcome became known
 * (agents/oracle/evaluate.ts outcomeKnownAt); this is the rule on top, pure for tests/node/late-stakes.test.ts.
 */
export type StakeTime = { at: number; user?: string };

/** The stakes at or after `knownAt` (unix seconds); none when the moment is unknown. */
export function lateStakes(knownAt: number | null, stakes: readonly StakeTime[]): StakeTime[] {
  if (knownAt === null || !Number.isFinite(knownAt)) return [];
  return stakes.filter((s) => s.at >= knownAt);
}

export function lateStakeSummary(knownAt: number, late: readonly StakeTime[]): string {
  const when = new Date(knownAt * 1000).toISOString().slice(0, 16).replace("T", " ");
  return `Refunded: ${late.length} stake${late.length === 1 ? "" : "s"} came in after the outcome was known (${when} UTC). A market has to close before its result is public, so nobody is paid from it.`;
}
