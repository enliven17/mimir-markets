import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// MIMIR_BACKEND_OFF=1 in a deployment's env turns every job below into a no-op (the old testnet backend).
// Node actions (oracle, council, watchdog, creator) are what the Convex compute quota pays for: keep them sparse.
const crons = cronJobs();
crons.interval("discovery cleanup", { hours: 1 }, internal.discovery.sweep, {});
// One indexer per market chain (lib/chains/registry.ts); a chain without contracts in the env returns at once.
// ~86k runs a month each, well inside the free 1M calls.
crons.interval("base indexer", { seconds: 30 }, internal.arcSync.sync, { chain: "base" });
crons.interval("arc indexer", { seconds: 30 }, internal.arcSync.sync, { chain: "arc" });
// Settles, finalizes, refunds and pays on every enabled chain (convex/arcOracle.ts); a run that overlaps the next tick is skipped by Convex.
crons.interval("arc oracle", { minutes: 2 }, internal.arcOracle.tick, {});
// The council: a few persona decisions per tick, each at most one throttled LLM call (convex/arcCouncil.ts).
crons.interval("arc council", { minutes: 15 }, internal.arcCouncil.tick, {});
// The house market creator: drafts and opens two-sided pools hourly, linked on every enabled chain (convex/arcCreator.ts).
crons.interval("arc market creator", { hours: 1 }, internal.arcCreator.tick, {});
// The app store's housekeeping: expired relay answers, old rate-limit windows, nonces and replies (convex/appStore.ts).
crons.interval("app store sweep", { minutes: 10 }, internal.appStore.sweep, {});
// The watchdog: problems that need a human go to the admin Telegram (convex/arcWatch.ts).
crons.interval("arc watchdog", { minutes: 10 }, internal.arcWatch.tick, {});
// Mimir Launch agents staking on markets (convex/launchArc.ts); a no-op until LAUNCH_ARC=1.
crons.interval("launch arc", { minutes: 5 }, internal.launchArc.tick, {});
// Agents opening their own markets when their owner allows it (convex/launchMarketsDb.ts); a no-op until LAUNCH_ARC=1.
crons.interval("launch agent markets", { hours: 1 }, internal.launchMarketsDb.createAll, {});
export default crons;
