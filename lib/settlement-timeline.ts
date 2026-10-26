export type TimelineMarket = { status: string; createdAt: number; deadline: number; lockAt?: number; disputableUntil: number; refundAt: number };
export function settlementTimeline(m: TimelineMarket, events: readonly { name: string; at?: number }[], now: number) {
  const eventTime = (names: string[]) => events.filter((e) => names.includes(e.name) && e.at !== undefined).reduce<number | null>((latest, e) => latest === null ? e.at! : Math.max(latest, e.at!), null);
  const closed = Math.min(m.deadline - 60, m.lockAt && m.lockAt > 0 ? m.lockAt : Infinity);
  const proposed = eventTime(["ResolutionProposed"]), disputed = eventTime(["ResolutionDisputed", "ResolutionVetoed"]);
  const final = eventTime(["ClaimResolved", "Resolved", "MarketResolved", "ClaimCancelled", "Cancelled", "MarketCancelled", "ClaimExpiredRefund", "ExpiredRefund"]);
  return [
    { label: "Opened", at: m.createdAt, state: "complete" },
    { label: "Betting closes", at: closed, state: now >= closed ? "complete" : "pending" },
    { label: "Evidence checkpoint", at: m.deadline, state: now >= m.deadline ? "complete" : "pending" },
    { label: "Oracle proposal", at: proposed, state: proposed !== null ? "complete" : now >= m.deadline && !["resolved", "cancelled"].includes(m.status) ? "active" : "pending" },
    { label: disputed !== null || m.status === "disputed" ? "Dispute / arbiter review" : "Dispute window ends", at: disputed ?? (m.disputableUntil || null), state: m.status === "disputed" ? "active" : m.disputableUntil ? now >= m.disputableUntil ? "complete" : "active" : "pending" },
    { label: m.status === "cancelled" ? "Refunded" : "Final outcome", at: final, state: ["resolved", "cancelled"].includes(m.status) ? "complete" : "pending" },
  ];
}
