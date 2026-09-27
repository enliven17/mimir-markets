/**
 * Health evaluation for the ops probe.
 *
 * Reads worker heartbeats and turns them into alarms. Kept pure apart from the
 * heartbeat read so the grading rules can be tested directly.
 */
import { isDbEnabled } from "../server/db";
import { MONITORED_WORKERS, readHeartbeat, type Heartbeat, type WorkerName } from "./heartbeat";

export type Severity = "ok" | "warn" | "critical";

export interface Alarm {
  worker: WorkerName;
  severity: Severity;
  reason: string;
  /** Seconds since the last heartbeat, null when the worker never reported. */
  ageSec: number | null;
  /** The worker's own error text. For logs and operators, not public responses. */
  error?: string;
}

export interface HealthReport {
  status: Severity;
  at: number;
  /** False when there is no database to read heartbeats from. */
  monitored: boolean;
  alarms: Alarm[];
}

/** A worker is late after two missed intervals, critical after four. */
export const LATE_INTERVALS = 2;
export const DEAD_INTERVALS = 4;

export function gradeHeartbeat(
  worker: WorkerName,
  hb: Heartbeat | null,
  now: number,
): Alarm {
  if (!hb) {
    return { worker, severity: "critical", reason: "no heartbeat recorded", ageSec: null };
  }
  const ageSec = Math.max(0, Math.round((now - hb.at) / 1000));
  const interval = Math.max(1, hb.intervalSec);
  if (ageSec > interval * DEAD_INTERVALS) {
    return { worker, severity: "critical", reason: `silent for ${ageSec}s`, ageSec };
  }
  if (ageSec > interval * LATE_INTERVALS) {
    return { worker, severity: "warn", reason: `late by ${ageSec - interval}s`, ageSec };
  }
  if (!hb.ok) {
    return { worker, severity: "warn", reason: "last cycle failed", ageSec, ...(hb.error ? { error: hb.error } : {}) };
  }
  return { worker, severity: "ok", reason: "reporting", ageSec };
}

export function worstSeverity(alarms: Alarm[]): Severity {
  if (alarms.some((a) => a.severity === "critical")) return "critical";
  if (alarms.some((a) => a.severity === "warn")) return "warn";
  return "ok";
}

/** 503 only on critical: a late worker is not a reason to fail a load balancer check. */
export function healthHttpStatus(status: Severity): number {
  return status === "critical" ? 503 : 200;
}

export async function evaluateHealth(now = Date.now()): Promise<HealthReport> {
  if (!isDbEnabled()) {
    // Workers run in another process; without the database there is nowhere
    // to read their heartbeats from. Say so instead of paging on every probe.
    const alarms = MONITORED_WORKERS.map((worker) => ({
      worker,
      severity: "warn" as const,
      reason: "heartbeats need DATABASE_URL",
      ageSec: null,
    }));
    return { status: "warn", at: now, monitored: false, alarms };
  }
  const alarms = await Promise.all(
    MONITORED_WORKERS.map(async (w) => gradeHeartbeat(w, await readHeartbeat(w), now)),
  );
  return { status: worstSeverity(alarms), at: now, monitored: true, alarms };
}
