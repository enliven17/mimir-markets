import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// The scoped Zod 4 override must preserve Reown's wallet message boundary, including malformed input rejection.
test("patched wallet schemas accept network/theme messages and reject malformed payloads", async () => {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@reown/appkit-wallet");
  const schema = await import(pathToFileURL(resolve(dirname(entry), "../src/W3mFrameSchema.js")).href);
  assert.equal(schema.AppSwitchNetworkRequest.safeParse({ chainId: 8453, rpcUrl: "https://mainnet.base.org" }).success, true);
  assert.equal(schema.AppSwitchNetworkRequest.safeParse({ chainId: { injected: true } }).success, false);
  assert.equal(schema.AppSyncThemeRequest.safeParse({ themeMode: "dark", themeVariables: { spacing: 2, color: "#fff" }, w3mThemeVariables: { background: "black" } }).success, true);
  assert.equal(schema.AppSyncThemeRequest.safeParse({ themeVariables: { malicious: [] } }).success, false);
  assert.equal(schema.W3mFrameSchema.frameEvent.safeParse({ type: "unknown", payload: { arbitrary: true } }).success, false);
});
