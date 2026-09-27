/**
 * Worker heartbeats.
 *
 * Each poll loop reports into `app_meta` so the health endpoint can tell a
 * worker that is alive from one that died quietly. Writes are best-effort: a
 * database outage (or no DATABASE_URL at all) must never stop an agent from
 * settling markets.
 */
import { getMeta, isDbEnabled, setMeta } from "../server/db";
import { capabilityForWorker, isPaused } from "./flags";

export type WorkerName = "oracle" | "market_creator" | "council" | "indexer";

export const MONITORED_WORKERS: WorkerName[] = ["oracle", "market_creator", "council", "indexer"];

export interface Heartbeat {
  worker: WorkerName;
  /** ms epoch of the last report, whether it succeeded or failed. */
  at: number;
  /** How often this worker is expected to report, in seconds. */
  intervalSec: number;
  ok: boolean;
  error?: string;
}

const key = (worker: WorkerName) => `heartbeat:${worker}`;

export async function beat(
  worker: WorkerName,
  intervalSec: number,
  ok: boolean,
  error?: unknown,
): Promise<void> {
  if (!isDbEnabled()) return;
  const payload: Heartbeat = {
    worker,
    at: Date.now(),
    intervalSec,
    ok,
    ...(error === undefined ? {} : { error: String(error instanceof Error ? error.message : error).slice(0, 300) }),
  };
  try {
    await setMeta(key(worker), JSON.stringify(payload));
  } catch {
    /* heartbeats are advisory, never load-bearing */
  }
}

export async function readHeartbeat(worker: WorkerName): Promise<Heartbeat | null> {
  try {
    const raw = await getMeta(key(worker));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Heartbeat;
    return parsed && typeof parsed.at === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Wrap a poll loop so it reports on every cycle, honours the worker's pause
 * switch, and never overlaps itself: a tick that fires while the previous poll
 * is still running (slow RPC, slow LLM) is skipped rather than started on top
 * of it, so two polls can never act on the same claim at once.
 *
 * Beats once immediately on startup: without it a restarted worker looks dead
 * until its first full interval elapses, which for the market creator is an
 * hour.
 */
export function reportingPoll(
  worker: WorkerName,
  intervalMs: number,
  poll: () => Promise<void>,
): () => Promise<void> {
  const intervalSec = Math.round(intervalMs / 1000);
  void beat(worker, intervalSec, true);
  const pauseSwitch = capabilityForWorker(worker);
  let running = false;
  return async () => {
    if (running) {
      console.log(`[${worker}] previous cycle still running, skipping this tick.`);
      return;
    }
    running = true;
    try {
      if (pauseSwitch && isPaused(pauseSwitch)) {
        console.log(`[${worker}] paused (MIMIR_PAUSE_${pauseSwitch.toUpperCase()}), skipping this cycle.`);
        await beat(worker, intervalSec, true);
        return;
      }
      try {
        await poll();
        await beat(worker, intervalSec, true);
      } catch (err) {
        console.error(`[${worker}] cycle failed, will retry next interval:`, err);
        await beat(worker, intervalSec, false, err);
      }
    } finally {
      running = false;
    }
  };
}
