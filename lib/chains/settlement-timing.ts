/** Indexed proposal/dispute timing, in Unix seconds, shared by both market families. */
export function settlementTiming(deadline: bigint, proposedAt: bigint, disputedAt: bigint, window: bigint) {
  const latest = [deadline, proposedAt, disputedAt].reduce((a, b) => a > b ? a : b);
  return {
    disputableUntil: proposedAt > 0n ? Number(proposedAt + window) : 0,
    refundAt: Number(latest + 7n * 86_400n),
  };
}
