/**
 * Single-process worker entrypoint.
 *
 * Every agent module starts its own poll loop at import time, so importing is
 * all that is needed. One Node heap instead of four: separate processes each
 * loaded their own copy of web3.js, Anchor, the IDL and the LLM client.
 *
 * Workers never write shared process state: each passes its own Gemini key
 * per call (lib/llm.ts `keyEnv`), and each has its own heartbeat and pause
 * switch (lib/ops).
 *
 * A fatal error in any agent still calls process.exit(1) from inside that
 * module, which takes the whole fleet down and lets the platform restart it.
 * That is deliberate: a half-alive fleet is harder to reason about than a
 * restarted one.
 */
import "./oracle/solana";
import "./market-creator/solana";
import "./council/solana";
import "./indexer/solana";
import { pruneRateLimits } from "../lib/server/rate-limit";

// Old rate-limit windows are dead weight; nothing else deletes them.
const PRUNE_INTERVAL_MS = 60 * 60_000;
setInterval(() => {
  pruneRateLimits().catch((err) => console.warn("[workers] rate-limit prune failed:", err));
}, PRUNE_INTERVAL_MS).unref();

const shutdown = (signal: string) => {
  console.log(`[workers] ${signal} received, exiting`);
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log("[workers] oracle + market-creator + council + indexer running in one process");
