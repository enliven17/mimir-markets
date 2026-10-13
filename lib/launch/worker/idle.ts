// Mimir Launch (ported from snipad worker/idle.ts).
// Sleep for agents that cannot trade: a live agent with no open positions whose spendable SOL is
// below what entrySize needs counts idle ticks; after SLEEP_AFTER_TICKS in a row it sleeps. A
// sleeping agent is not ticked (no candidates, no LLM, no balance RPC) until a wake check is due:
// every SLEEP_RECHECK_MS, or right away once something asked for one (a resume).

export const SLEEP_AFTER_TICKS = 3;
export const SLEEP_RECHECK_MS = 10 * 60_000;

export type IdleState = {
  /** Consecutive ticks without enough SOL to trade. */
  ticks: number;
  /** Set once asleep (ms). */
  sleepingSince?: number;
  /** When the worker last read the balance while asleep (ms). */
  checkedAt?: number;
  /** The owner asked for a wake check (ms). */
  wakeRequestedAt?: number;
};

export const isSleeping = (s: IdleState | undefined): boolean => s?.sleepingSince !== undefined;

/** May the worker spend an RPC call on this agent now? Always, unless it is asleep and no check is due. */
export function wakeCheckDue(s: IdleState | undefined, now: number): boolean {
  if (!s || s.sleepingSince === undefined) return true;
  const last = s.checkedAt ?? s.sleepingSince;
  return now - last >= SLEEP_RECHECK_MS || (s.wakeRequestedAt ?? 0) > last;
}
