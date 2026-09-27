#!/usr/bin/env node
/**
 * Production entrypoint (Railway `npm run start:all`): the Next.js server and
 * the single-process worker fleet side by side.
 *
 * If either exits, the other is stopped and this process exits non-zero, so
 * the platform's restart policy brings both back instead of leaving the site
 * up with dead workers (or the reverse).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT || "3000";

const children = [
  ["web", [require.resolve("next/dist/bin/next"), "start", "-p", port]],
  ["workers", [require.resolve("tsx/cli"), "--env-file-if-exists=.env.local", "agents/all.ts"]],
].map(([name, args]) => {
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
