import { open, readFile, rename, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { proposalKey, type AuditJob } from "./review";

export interface AuditState {
  version: 1; deployment: string; cursors: Record<string, string>;
  seen: Record<string, number>; jobs: Record<string, AuditJob>;
}
export async function readAuditState(path: string, deployment: string): Promise<AuditState> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, deployment, cursors: {}, seen: {}, jobs: {} };throw err; }
  const state = JSON.parse(raw) as AuditState;
  if (state.version !== 1 || state.deployment !== deployment) throw Error("Audit checkpoint deployment mismatch; use a fresh state file");
  if (!state.cursors || !state.seen || !state.jobs || Object.values(state.cursors).some(v => !/^\d+$/.test(v))) throw Error("Corrupted audit checkpoint");
  for (const [key, job] of Object.entries(state.jobs)) {
    if (!["vs", "pool"].includes(job.proposal.kind) || proposalKey(job.proposal) !== key) throw Error("Corrupted audit proposal identity");
  }
  return state;
}
export async function saveAuditState(path: string, state: AuditState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(state));await file.sync(); }
  finally { await file.close(); }
  try { await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
/** No automatic stale-lock stealing: that can create two signers using the same nonce stream. */
export async function lockAuditState(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;await mkdir(lock, { mode: 0o700 });
  const file = await open(`${lock}/pid`, "wx", 0o600);
  try { await file.writeFile(String(process.pid)); } finally { await file.close(); }
  let released = false;
  return async () => { if (!released) { released = true;await rm(lock, { recursive: true }); } };
}
