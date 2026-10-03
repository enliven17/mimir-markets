#!/usr/bin/env node
/**
 * Entrypoint (`npm run start:all`, railway.json): the Next.js server and the
 * single-process worker fleet.
 *
 * MIMIR_SERVICE picks what this process runs:
 *   web      → only `next start` (give this service NO keypair env)
 *   workers  → only agents/all.ts
 *   unset    → both side by side (local/dev, devnet single-service deploys)
 * The internet-facing web process must never hold a private key (audit P0-1),
 * so on mainnet "both" is refused unless START_ALL_MAINNET=1.
 *
 * If a child exits, the rest are stopped and this process exits non-zero, so
 * the platform's restart policy brings everything back instead of leaving the
 * site up with dead workers (or the reverse).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const service = process.env.MIMIR_SERVICE?.trim().toLowerCase() || "all";
if (!["all", "web", "workers"].includes(service)) {
  console.error(`[start-all] MIMIR_SERVICE must be "web", "workers" or unset, got "${service}"`);
  process.exit(1);
}
if (
  service === "all" &&
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() === "mainnet-beta" &&
  process.env.START_ALL_MAINNET?.trim() !== "1"
) {
  console.error(
    "[start-all] refusing to run web + workers in one process on mainnet: " +
      "run two services with MIMIR_SERVICE=web and MIMIR_SERVICE=workers " +
      "(or `npm run start:web` / `npm run start:workers`); START_ALL_MAINNET=1 overrides.",
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT || "3000";

const children = [
  ["web", [require.resolve("next/dist/bin/next"), "start", "-p", port]],
  ["workers", [require.resolve("tsx/cli"), "--env-file-if-exists=.env.local", "agents/all.ts"]],
]
  .filter(([name]) => service === "all" || service === name)
  .map(([name, args]) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
    child.on("exit", (code, signal) => {
      console.log(`[start-all] ${name} exited (${signal ?? code}), stopping the rest`);
      stopAll(code ?? 1);
    });
    return child;
  });

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exitCode = code === 0 ? 1 : code;
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
    for (const child of children) if (child.exitCode === null) child.kill(signal);
  });
}
