import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAuditState, saveAuditState, lockAuditState } from "../../agents/audit/state";

test("audit checkpoints bind deployment and reject corrupted state rather than silently resetting", async () => {
  const root = await mkdtemp(join(tmpdir(), "mimir-audit-state-"));const path = join(root, "state.json");
  try {
    const state = await readAuditState(path, "base-contract-auditor");
    state.cursors.base = "123";await saveAuditState(path, state);
    assert.equal((await readAuditState(path, "base-contract-auditor")).cursors.base, "123");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(readAuditState(path, "arc-another-contract"), /deployment/i);
    await writeFile(path, "{broken");await assert.rejects(readAuditState(path, "base-contract-auditor"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only one local audit worker can own a checkpoint file", async () => {
  const root = await mkdtemp(join(tmpdir(), "mimir-audit-lock-"));const path = join(root, "state.json");
  try {
    const release = await lockAuditState(path);
    await assert.rejects(lockAuditState(path), /lock|EEXIST/i);
    await release();const releaseAgain = await lockAuditState(path);await releaseAgain();
  } finally { await rm(root, { recursive: true, force: true }); }
});
