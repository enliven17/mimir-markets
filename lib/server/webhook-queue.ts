/**
 * Fire-and-forget webhook delivery for the indexer (audit P2-9): a slow or
 * dead receiver must not stall the loop that mirrors chain state.
 *
 *  - bounded concurrency (default 4 in flight) and a bounded pending queue
 *  - per-URL circuit breaker: after 3 consecutive failed deliveries the URL is
 *    skipped for 10 minutes, then tried again
 *
 * In-memory and per process: a restart forgets breaker state, which only
 * means one more round of attempts.
 */
export interface DeliveryQueueOptions {
  concurrency?: number;
  maxPending?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  now?: () => number;
}

export interface DeliveryQueue {
  /** Queue a delivery; false when skipped (breaker open or queue full). Never blocks. */
  enqueue(url: string, job: () => Promise<void>): boolean;
  /** Resolves once nothing is running or pending (tests, shutdown). */
  idle(): Promise<void>;
}

export function createDeliveryQueue(opts: DeliveryQueueOptions = {}): DeliveryQueue {
  const concurrency = opts.concurrency ?? 4;
  const maxPending = opts.maxPending ?? 1_000;
  const threshold = opts.breakerThreshold ?? 3;
  const cooldownMs = opts.breakerCooldownMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now;

  const pending: Array<{ url: string; job: () => Promise<void> }> = [];
  const breakers = new Map<string, { failures: number; openUntil: number }>();
  let running = 0;
  let idleWaiters: Array<() => void> = [];

  function isOpen(url: string): boolean {
    const b = breakers.get(url);
    return Boolean(b && b.openUntil > now());
  }

  function settle(url: string, ok: boolean): void {
    if (ok) {
      breakers.delete(url);
      return;
    }
    const b = breakers.get(url) ?? { failures: 0, openUntil: 0 };
    const failures = b.failures + 1;
    breakers.set(url, failures >= threshold ? { failures: 0, openUntil: now() + cooldownMs } : { failures, openUntil: 0 });
    // Bounded: forget the oldest breaker entries if many distinct URLs fail.
    while (breakers.size > 10_000) {
      const oldest = breakers.keys().next().value;
      if (oldest === undefined) break;
      breakers.delete(oldest);
    }
  }

  function pump(): void {
    while (running < concurrency && pending.length > 0) {
      const next = pending.shift()!;
      if (isOpen(next.url)) continue;
      running++;
      next
        .job()
        .then(
          () => settle(next.url, true),
          (err) => {
            settle(next.url, false);
            console.warn("[notifications] webhook delivery failed:", err instanceof Error ? err.message : String(err));
          },
        )
        .finally(() => {
          running--;
          pump();
        });
    }
    if (running === 0 && pending.length === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  return {
    enqueue(url, job) {
      if (isOpen(url)) return false;
      if (pending.length >= maxPending) return false;
      pending.push({ url, job });
      pump();
      return true;
    },
    idle() {
      if (running === 0 && pending.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
