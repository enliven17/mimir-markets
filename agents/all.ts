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
 * restarted one. Startup validation is never swallowed either: a module that
 * throws while loading (e.g. an invalid HEDGE_MODE) fails this import graph
 * and the process exits non-zero; each agent's main() exits on its own fatal
 * error; on mainnet the keys below must load or the fleet stops.
 */
import "./oracle/solana";
import "./market-creator/solana";
import "./council/solana";
import "./indexer/solana";
import { pruneRateLimits } from "../lib/server/rate-limit";
import { pruneAgentTables } from "../lib/agents/store";
import { isDbEnabled } from "../lib/server/db";
import { IS_MAINNET, MIMIR_PROGRAM_ID, SOLANA_CLUSTER } from "../lib/solana/config";
import { loadAgentKeypair, loadCreatorPublicKey } from "../lib/solana/keypair";

/** Which cluster, program and keys this fleet runs with; on mainnet a key that can't load (or is shared) stops it. */
function announceCluster(): void {
  console.log(`[workers] cluster ${SOLANA_CLUSTER} · program ${MIMIR_PROGRAM_ID.toBase58()}`);
  if (!IS_MAINNET) return;
  try {
    const oracle = loadAgentKeypair().publicKey.toBase58();
    const creator = loadCreatorPublicKey().toBase58();
    console.log(`[workers] oracle  ${oracle}`);
    console.log(`[workers] creator ${creator}`);
    if (creator === oracle) throw new Error("the creator key must differ from the oracle key on mainnet");
  } catch (err) {
    console.error("[workers] Fatal: mainnet key setup:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

announceCluster();

// Old rate-limit windows and agent API nonces, replay answers and audit rows
// are dead weight; nothing else deletes them.
const PRUNE_INTERVAL_MS = 60 * 60_000;
setInterval(() => {
  pruneRateLimits().catch((err) => console.warn("[workers] rate-limit prune failed:", err));
  if (isDbEnabled()) {
    pruneAgentTables().catch((err) => console.warn("[workers] agent api prune failed:", err));
  }
}, PRUNE_INTERVAL_MS).unref();

const shutdown = (signal: string) => {
  console.log(`[workers] ${signal} received, exiting`);
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log("[workers] oracle + market-creator + council + indexer running in one process");
