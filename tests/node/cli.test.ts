import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "mimir-cli-"));
const mimir = (...args: string[]) =>
  execFileSync(process.execPath, ["cli/bin/mimir.mjs", ...args], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" } });

test("the mimir CLI saves your own agents and never needs Mimir's AI for them", () => {
  assert.match(mimir("--version"), /^\d+\.\d+\.\d+/);
  assert.match(mimir("agent", "add", "py", "exec", "node", "-e", "x"), /py saved/);
  assert.match(mimir("agent", "add", "bad", "http", "not-a-url"), /needs a URL/);
  assert.match(mimir("ai", "https://example.com/v1", "m", "sk-123"), /NAME of an env var/, "a pasted key is refused, never stored");
  assert.match(mimir("frobnicate"), /unknown command/);
});
