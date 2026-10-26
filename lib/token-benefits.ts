import type { TokenTier } from "./token-tiers";
export function previewBenefits(tier: TokenTier) {
  return { chartPoints: ({ none: 144, holder: 288, backer: 576, "oracle-circle": 864 } as const)[tier],
    aiCallsPerAgentDay: ({ none: 6, holder: 8, backer: 10, "oracle-circle": 12 } as const)[tier] };
}
export type EntryEvent = { name: string; txHash: string; logIndex: number; amount?: string; user?: string; at?: number };
/** Pool entry fee is emitted before Staked. Exclude ambiguous log segments rather than infer a holder tier. */
export function verifiedPoolSavings(events: readonly EntryEvent[], user: string, since: number) {
  const transactions = new Map<string, EntryEvent[]>();
  for (const e of events) transactions.set(e.txHash, [...transactions.get(e.txHash) ?? [], e]);
  let gross = 0n, paid = 0n, saved = 0n, entries = 0;
  for (const rows of transactions.values()) {
    let fees: EntryEvent[] = [];
    for (const e of rows.sort((a, b) => a.logIndex - b.logIndex)) {
      if (e.name === "FeeAccrued") fees.push(e);
      if (e.name !== "Staked") continue;
      if (e.user?.toLowerCase() === user.toLowerCase() && e.at !== undefined && e.at >= since && e.amount && fees.length === 1 && fees[0].amount) {
        const fee = BigInt(fees[0].amount), amount = BigInt(e.amount) + fee, standard = amount * 50n / 10_000n;
        if (fee <= standard) { gross += amount; paid += fee; saved += standard - fee; entries++; }
      }
      fees = [];
    }
  }
  return { entries, gross: gross.toString(), paid: paid.toString(), saved: saved.toString() };
}
