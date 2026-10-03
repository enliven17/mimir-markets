import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.join(process.cwd(), "scripts", "start-all.mjs");

test("start:all refuses to co-host web and workers on mainnet", () => {
  const res = spawnSync(process.execPath, [script], {
    env: { ...process.env, NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet-beta", START_ALL_MAINNET: "", MIMIR_SERVICE: "" },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /refusing/);
});

test("start:all rejects an unknown MIMIR_SERVICE", () => {
  const res = spawnSync(process.execPath, [script], {
    env: { ...process.env, MIMIR_SERVICE: "everything" },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /MIMIR_SERVICE/);
});
